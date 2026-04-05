import { Message } from 'discord.js';
import { chat, type ChatMessage } from './utils/llm.js';
import { buildSystemPrompt } from './prompts/system.js';
import { appendMessage, loadConversationLog } from './brain/memory.js';
import { loadState, saveState } from './brain/state.js';
import { reflect, shouldReflect } from './brain/reflection.js';
import { updateResponseRate } from './proactive/backoff.js';
import { logger } from './utils/logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Handle an incoming message from the owner.
 */
export async function handleMessage(message: Message): Promise<void> {
  try {
    // 1. Show typing indicator
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }

    // 2. Log the incoming message
    await appendMessage({
      role: 'owner',
      content: message.content,
      timestamp: new Date().toISOString(),
    });

    // 3. Update relational state
    const state = await loadState();
    state.lastOwnerMessage = new Date().toISOString();
    state.outreachAttemptsSinceResponse = 0; // they responded!
    state.ownerResponseRate = updateResponseRate(state, true);
    state.messagesSinceLastReflection++;
    await saveState(state);

    // 4. Build system prompt with full context
    const systemPrompt = await buildSystemPrompt();

    // 5. Load recent conversation for multi-turn context
    const recentMessages = await loadConversationLog();
    const chatMessages: ChatMessage[] = recentMessages.map((m) => ({
      role: m.role === 'owner' ? 'user' : 'model',
      content: m.content,
    }));

    // 6. Generate response
    const response = await chat(systemPrompt, chatMessages, {
      maxTokens: 300,
      temperature: 0.85,
    });

    // 7. Natural typing delay (30ms per character, clamped 0.8s–3s)
    const typingDelay = Math.min(
      Math.max(response.content.length * 30, 800),
      3000
    );
    await sleep(typingDelay);

    // 8. Send response
    await message.reply(response.content);

    // 9. Log bot response
    await appendMessage({
      role: 'bot',
      content: response.content,
      timestamp: new Date().toISOString(),
    });

    // 10. Maybe trigger async reflection
    if (shouldReflect(state.messagesSinceLastReflection)) {
      logger.info('Triggering reflection...');
      reflect().catch((err) =>
        logger.error('Background reflection failed', err)
      );
    }
  } catch (err) {
    logger.error('Failed to handle message', err);

    // Graceful degradation: try to send something
    try {
      await message.reply(
        "sorry, something went sideways in my head. give me a sec and try again?"
      );
    } catch {
      // If even this fails, just log it
      logger.error('Could not send error message to Discord');
    }
  }
}
