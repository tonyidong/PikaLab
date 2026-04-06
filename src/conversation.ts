import { Message, TextChannel, DMChannel } from 'discord.js';
import { chat, type ChatMessage } from './utils/llm.js';
import { buildSystemPrompt } from './prompts/system.js';
import { appendMessage, loadConversationLog } from './brain/memory.js';
import { loadState, saveState } from './brain/state.js';
import { reflect, shouldReflect } from './brain/reflection.js';
import { updateResponseRate } from './proactive/backoff.js';
import { logger } from './utils/logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BATCH_DELAY_MS = 1500;

// Dedup — Discord sometimes delivers the same event twice
const seenIds = new Set<string>();

// Ensures only one response is being generated at a time
let busy = false;
let queued: Message[] = [];

export async function handleMessage(message: Message): Promise<void> {
  // Hard dedup by Discord message ID
  if (seenIds.has(message.id)) return;
  seenIds.add(message.id);
  if (seenIds.size > 500) {
    const keep = [...seenIds].slice(-250);
    seenIds.clear();
    keep.forEach((id) => seenIds.add(id));
  }

  queued.push(message);

  // If we're already generating a response, just queue it for the next round
  if (busy) return;

  busy = true;
  try {
    while (queued.length > 0) {
      // Small window to batch rapid-fire messages
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
    // Typing indicator
    if ('sendTyping' in channel) {
      await channel.sendTyping();
    }

    // 1. Load existing context FIRST (before we mutate the log)
    const [systemPrompt, history, state] = await Promise.all([
      buildSystemPrompt(),
      loadConversationLog(),
      loadState(),
    ]);

    // 2. Build the messages array for the LLM:
    //    existing history + this new owner message
    const chatMessages: ChatMessage[] = history.map((m) => ({
      role: m.role === 'owner' ? ('user' as const) : ('model' as const),
      content: m.content,
    }));
    chatMessages.push({ role: 'user', content: ownerText });

    // 3. Generate response
    const response = await chat(systemPrompt, chatMessages, {
      maxTokens: 300,
      temperature: 0.85,
    });

    logger.info(`[${messages.length} msg] → "${response.content.slice(0, 80)}"`);

    // 4. Natural delay
    const delay = Math.min(Math.max(response.content.length * 30, 800), 3000);
    await sleep(delay);

    // 5. Send to Discord
    await channel.send(response.content);

    // 6. NOW persist both sides to the log (after successful send)
    await appendMessage({
      role: 'owner',
      content: ownerText,
      timestamp: new Date().toISOString(),
    });
    await appendMessage({
      role: 'bot',
      content: response.content,
      timestamp: new Date().toISOString(),
    });

    // 7. Update relational state
    state.lastOwnerMessage = new Date().toISOString();
    state.outreachAttemptsSinceResponse = 0;
    state.ownerResponseRate = updateResponseRate(state, true);
    state.messagesSinceLastReflection += 1;
    await saveState(state);

    // 8. Maybe trigger async reflection
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
