import { Message, TextChannel, DMChannel } from 'discord.js';
import { chat, type ChatMessage } from './utils/llm.js';
import { buildSystemPrompt } from './prompts/system.js';
import { appendMessage, loadConversationLog } from './brain/memory.js';
import { loadState, saveState } from './brain/state.js';
import { reflect, shouldReflect } from './brain/reflection.js';
import { updateResponseRate } from './proactive/backoff.js';
import { logger } from './utils/logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BATCH_WINDOW_MS = 2000;

// Serial queue — only one response generation at a time
let processing = false;
const queue: Array<() => Promise<void>> = [];

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    await task();
  }
  processing = false;
}

// Batching — collect rapid messages before responding
let pendingMessages: Message[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Handle an incoming message from the owner.
 * Batches rapid messages, then processes them as one turn.
 */
export async function handleMessage(message: Message): Promise<void> {
  pendingMessages.push(message);

  if (batchTimer) clearTimeout(batchTimer);

  batchTimer = setTimeout(() => {
    const batch = [...pendingMessages];
    pendingMessages = [];
    batchTimer = null;

    queue.push(() => processBatch(batch));
    drainQueue();
  }, BATCH_WINDOW_MS);
}

async function processBatch(messages: Message[]): Promise<void> {
  if (messages.length === 0) return;

  const channel = messages[0].channel;
  const combinedContent = messages.map((m) => m.content).join('\n');

  try {
    // Show typing indicator
    if ('sendTyping' in channel) {
      await (channel as TextChannel | DMChannel).sendTyping();
    }

    // Log all incoming messages
    for (const msg of messages) {
      await appendMessage({
        role: 'owner',
        content: msg.content,
        timestamp: new Date().toISOString(),
      });
    }

    // Update relational state
    const state = await loadState();
    state.lastOwnerMessage = new Date().toISOString();
    state.outreachAttemptsSinceResponse = 0;
    state.ownerResponseRate = updateResponseRate(state, true);
    state.messagesSinceLastReflection += messages.length;
    await saveState(state);

    // Build system prompt with full context
    const systemPrompt = await buildSystemPrompt();

    // Load recent conversation for multi-turn context
    const recentMessages = await loadConversationLog();
    const chatMessages: ChatMessage[] = recentMessages.map((m) => ({
      role: m.role === 'owner' ? 'user' : 'model',
      content: m.content,
    }));

    // Generate one response for the whole batch
    const response = await chat(systemPrompt, chatMessages, {
      maxTokens: 300,
      temperature: 0.85,
    });

    // Natural typing delay (30ms per character, clamped 0.8s–3s)
    const typingDelay = Math.min(
      Math.max(response.content.length * 30, 800),
      3000
    );
    await sleep(typingDelay);

    // Send as a normal message — not a reply, feels more human
    await (channel as TextChannel | DMChannel).send(response.content);

    // Log bot response
    await appendMessage({
      role: 'bot',
      content: response.content,
      timestamp: new Date().toISOString(),
    });

    // Maybe trigger async reflection
    const updatedState = await loadState();
    if (shouldReflect(updatedState.messagesSinceLastReflection)) {
      logger.info('Triggering reflection...');
      reflect().catch((err) =>
        logger.error('Background reflection failed', err)
      );
    }
  } catch (err) {
    logger.error('Failed to handle message batch', err);

    try {
      await (channel as TextChannel | DMChannel).send(
        "sorry, something went sideways in my head. give me a sec and try again?"
      );
    } catch {
      logger.error('Could not send error message to Discord');
    }
  }
}
