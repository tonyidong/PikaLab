import { Message, TextChannel, DMChannel, AttachmentBuilder, MessageFlags } from 'discord.js';
import { chat, type ChatMessage } from './utils/llm.js';
import { generateImage } from './utils/image.js';
import { transcribeAudio, textToSpeech } from './utils/audio.js';
import { sendVoiceMessage } from './utils/discord-voice.js';
import { buildSystemPrompt } from './prompts/system.js';
import { appendMessage, loadConversationLog } from './brain/memory.js';
import { loadState, saveState } from './brain/state.js';
import { reflect, shouldReflect } from './brain/reflection.js';
import { updateResponseRate } from './proactive/backoff.js';
import { logger } from './utils/logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BATCH_DELAY_MS = 1500;
const IMAGE_TAG_RE = /\[IMAGE:\s*(.+?)\]/i;
const REACT_TAG_RE = /\[REACT:\s*(.+?)\]/gi;
const URL_RE = /https?:\/\/[^\s]+/i;

// Dedup — Discord sometimes delivers the same event twice
const seenIds = new Set<string>();

// Ensures only one response is being generated at a time
let busy = false;
let queued: Message[] = [];

export async function handleMessage(message: Message): Promise<void> {
  if (seenIds.has(message.id)) return;
  seenIds.add(message.id);
  if (seenIds.size > 500) {
    const keep = [...seenIds].slice(-250);
    seenIds.clear();
    keep.forEach((id) => seenIds.add(id));
  }

  queued.push(message);

  if (busy) return;

  busy = true;
  try {
    while (queued.length > 0) {
      await sleep(BATCH_DELAY_MS);
      const batch = queued.splice(0);
      await respond(batch);
    }
  } finally {
    busy = false;
  }
}

async function respond(messages: Message[]): Promise<void> {
  if (messages.length === 0) return;
  const channel = messages[0].channel as TextChannel | DMChannel;

  // Detect voice messages and transcribe them
  let ownerText = '';
  let replyAsVoice = false;

  for (const msg of messages) {
    const isVoice = msg.flags.has(MessageFlags.IsVoiceMessage);
    if (isVoice) {
      replyAsVoice = true;
      const audioAttachment = msg.attachments.first();
      if (audioAttachment) {
        try {
          const audioResponse = await fetch(audioAttachment.url);
          const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
          const transcription = await transcribeAudio(audioBuffer, audioAttachment.contentType || 'audio/ogg');
          if (transcription) {
            ownerText += (ownerText ? '\n' : '') + transcription;
          } else {
            ownerText += (ownerText ? '\n' : '') + '(sent a voice message that I couldn\'t understand)';
          }
        } catch (err) {
          logger.error('Failed to process voice message', err);
          ownerText += (ownerText ? '\n' : '') + '(sent a voice message)';
        }
      }
    } else {
      ownerText += (ownerText ? '\n' : '') + msg.content;
      // If the user explicitly sends text after voice, switch back to text mode
      if (msg.content.length > 0) replyAsVoice = false;
    }
  }

  if (!ownerText.trim()) return;

  try {
    if ('sendTyping' in channel) {
      await channel.sendTyping();
    }

    // 1. Load context before mutating anything
    const [systemPrompt, history, state] = await Promise.all([
      buildSystemPrompt(),
      loadConversationLog(),
      loadState(),
    ]);

    // 2. Build messages for the LLM: history + new owner message
    const chatMessages: ChatMessage[] = history.map((m) => ({
      role: m.role === 'owner' ? ('user' as const) : ('model' as const),
      content: m.content,
    }));
    chatMessages.push({ role: 'user', content: ownerText });

    // 3. Check if owner explicitly asked for text reply while in voice mode
    const TEXT_MODE_RE = /\b(reply in text|text me|type it|send text|don'?t.*voice|no voice|text reply|write it)\b/i;
    if (replyAsVoice && TEXT_MODE_RE.test(ownerText)) {
      replyAsVoice = false;
    }

    // 4. Generate text response — enable web tools when URLs or search-worthy content is present
    const hasUrl = URL_RE.test(ownerText);
    const tools: Record<string, unknown>[] = [];
    if (hasUrl) tools.push({ urlContext: {} });
    tools.push({ googleSearch: {} });

    const response = await chat(systemPrompt, chatMessages, {
      maxTokens: 400,
      temperature: 0.85,
      tools,
    });

    logger.info(`[${messages.length} msg] → "${response.content.slice(0, 80)}"`);

    // 4a. Check for reactions — apply them to the last owner message
    const reactMatches = [...response.content.matchAll(REACT_TAG_RE)];
    let textToSend = response.content.replace(REACT_TAG_RE, '').trim();

    if (reactMatches.length > 0) {
      const lastOwnerMsg = messages[messages.length - 1];
      for (const match of reactMatches) {
        const emoji = match[1].trim();
        try {
          await lastOwnerMsg.react(emoji);
        } catch (err) {
          logger.warn(`Failed to react with ${emoji}`, err);
        }
      }
    }

    // 4b. Check if the LLM wants to generate an image
    const imageMatch = textToSend.match(IMAGE_TAG_RE);
    let imageBuffer: Buffer | null = null;

    if (imageMatch) {
      const imagePrompt = imageMatch[1];
      textToSend = textToSend.replace(IMAGE_TAG_RE, '').trim();
      logger.info(`Generating image: "${imagePrompt.slice(0, 80)}"`);

      // Keep typing indicator alive while generating
      if ('sendTyping' in channel) {
        await channel.sendTyping();
      }

      imageBuffer = await generateImage(imagePrompt);
    }

    // 5. Natural delay
    const delay = Math.min(Math.max((textToSend.length) * 30, 800), 3000);
    await sleep(delay);

    // 6. Send to Discord (voice / text+image / text / reaction-only)
    if (replyAsVoice && textToSend && !imageBuffer) {
      if ('sendTyping' in channel) await channel.sendTyping();
      const oggBuffer = await textToSpeech(textToSend);
      if (oggBuffer) {
        const sent = await sendVoiceMessage(channel.client, channel, oggBuffer);
        if (!sent) await channel.send(textToSend);
      } else {
        await channel.send(textToSend);
      }
    } else if (imageBuffer) {
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'image.png' });
      if (textToSend) {
        await channel.send({ content: textToSend, files: [attachment] });
      } else {
        await channel.send({ files: [attachment] });
      }
    } else if (textToSend) {
      await channel.send(textToSend);
    }

    // 7. Persist both sides to the log
    let botLogContent = imageMatch
      ? `${textToSend} (sent an image: ${imageMatch[1]})`
      : response.content;
    if (replyAsVoice) botLogContent += ' [replied as voice message]';

    const ownerLogContent = replyAsVoice
      ? `[voice message] ${ownerText}`
      : ownerText;

    await appendMessage({
      role: 'owner',
      content: ownerLogContent,
      timestamp: new Date().toISOString(),
    });
    await appendMessage({
      role: 'bot',
      content: botLogContent,
      timestamp: new Date().toISOString(),
    });

    // 8. Update relational state
    state.lastOwnerMessage = new Date().toISOString();
    state.outreachAttemptsSinceResponse = 0;
    state.ownerResponseRate = updateResponseRate(state, true);
    state.messagesSinceLastReflection += 1;
    await saveState(state);

    // 9. Maybe trigger async reflection
    if (shouldReflect(state.messagesSinceLastReflection)) {
      logger.info('Triggering reflection...');
      reflect().catch((err) =>
        logger.error('Background reflection failed', err)
      );
    }
  } catch (err) {
    logger.error('Failed to respond', err);
    try {
      await channel.send(
        "sorry, something went sideways in my head for a sec"
      );
    } catch {
      // nothing we can do
    }
  }
}
