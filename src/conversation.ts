import { Message, TextChannel, DMChannel, AttachmentBuilder } from 'discord.js';
import { chat, type ChatMessage } from './utils/llm.js';
import { generateImage } from './utils/image.js';
import { buildSystemPrompt } from './prompts/system.js';
import { appendMessage, loadConversationLog } from './brain/memory.js';
import { loadState, saveState } from './brain/state.js';
import { reflect, shouldReflect } from './brain/reflection.js';
import { updateResponseRate } from './proactive/backoff.js';
import { logger } from './utils/logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BATCH_DELAY_MS = 1500;
const IMAGE_TAG_RE = /\[IMAGE:\s*(.+?)\]/i;

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
  const ownerText = messages.map((m) => m.content).join('\n');

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

    // 3. Generate text response
    const response = await chat(systemPrompt, chatMessages, {
      maxTokens: 400,
      temperature: 0.85,
    });

    logger.info(`[${messages.length} msg] → "${response.content.slice(0, 80)}"`);

    // 4. Check if the LLM wants to generate an image
    const imageMatch = response.content.match(IMAGE_TAG_RE);
    let imageBuffer: Buffer | null = null;
    let textToSend = response.content;

    if (imageMatch) {
      const imagePrompt = imageMatch[1];
      textToSend = response.content.replace(IMAGE_TAG_RE, '').trim();
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

    // 6. Send to Discord (text + optional image)
    if (imageBuffer) {
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'image.png' });
      if (textToSend) {
        await channel.send({ content: textToSend, files: [attachment] });
      } else {
        await channel.send({ files: [attachment] });
      }
    } else {
      await channel.send(textToSend || response.content);
    }

    // 7. Persist both sides to the log
    const botLogContent = imageMatch
      ? `${textToSend} (sent an image: ${imageMatch[1]})`
      : response.content;

    await appendMessage({
      role: 'owner',
      content: ownerText,
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
