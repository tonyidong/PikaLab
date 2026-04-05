import { loadIdentity, saveIdentity } from './identity.js';
import { loadOwnerProfile, saveOwnerProfile, loadConversationLog } from './memory.js';
import { loadState, saveState, type RelationalState } from './state.js';
import { chatJSON } from '../utils/llm.js';
import { buildReflectionPrompt } from '../prompts/reflection.js';
import { generateAvatar } from '../avatar/generator.js';
import { logger } from '../utils/logger.js';

interface ReflectionResult {
  identityUpdates: string | null;
  ownerUpdates: string | null;
  stateUpdates: {
    relationshipStage?: 'new' | 'developing' | 'established';
    curiosityLevel?: number;
    topicsToExplore?: string[];
    pendingThoughts?: string[];
    botNameChosen?: boolean;
    shouldGenerateAvatar?: boolean;
  };
  reasoning: string;
}

export async function reflect(): Promise<void> {
  try {
    const [soul, owner, messages, state] = await Promise.all([
      loadIdentity(),
      loadOwnerProfile(),
      loadConversationLog(),
      loadState(),
    ]);

    if (messages.length < 2) {
      logger.debug('Not enough messages to reflect on');
      return;
    }

    const prompt = buildReflectionPrompt(soul, owner, messages, state);

    const result = await chatJSON<ReflectionResult>(
      'You are a reflective AI analyzing a conversation. Return only valid JSON.',
      [{ role: 'user', content: prompt }],
      { maxTokens: 2000, temperature: 0.3 }
    );

    if (!result) {
      logger.warn('Reflection produced no usable result');
      return;
    }

    // Apply identity updates
    if (result.identityUpdates && result.identityUpdates !== soul) {
      await saveIdentity(result.identityUpdates);
      logger.info('Identity updated');
    }

    // Apply owner profile updates
    if (result.ownerUpdates && result.ownerUpdates !== owner) {
      await saveOwnerProfile(result.ownerUpdates);
      logger.info('Owner profile updated');
    }

    // Merge state updates
    const updates = result.stateUpdates;
    if (updates.relationshipStage) state.relationshipStage = updates.relationshipStage;
    if (updates.curiosityLevel !== undefined) state.curiosityLevel = updates.curiosityLevel;
    if (updates.topicsToExplore) state.topicsToExplore = updates.topicsToExplore;
    if (updates.pendingThoughts) state.pendingThoughts = updates.pendingThoughts;
    if (updates.botNameChosen !== undefined) state.botNameChosen = updates.botNameChosen;

    state.lastReflection = new Date().toISOString();
    state.messagesSinceLastReflection = 0;
    state.conversationCount++;

    await saveState(state);

    logger.info('Reflection complete', result.reasoning);

    // Trigger avatar generation if warranted
    if (updates.shouldGenerateAvatar && !state.avatarGenerated) {
      generateAvatar().catch((err) => {
        logger.error('Avatar generation failed (non-blocking)', err);
      });
    }
  } catch (err) {
    logger.error('Reflection failed', err);
    // Non-fatal — we'll try again next cycle
  }
}

/**
 * Check if it's time to reflect based on message count.
 * Reflects every 3-5 messages (randomized to feel natural).
 */
export function shouldReflect(messagesSinceLastReflection: number): boolean {
  const threshold = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
  return messagesSinceLastReflection >= threshold;
}
