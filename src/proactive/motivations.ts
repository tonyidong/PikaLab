import { loadState } from '../brain/state.js';
import { chat } from '../utils/llm.js';
import { buildOutreachPrompt } from '../prompts/system.js';
import { shouldAttemptOutreach } from './backoff.js';
import { logger } from '../utils/logger.js';

/**
 * Pick a motivation for reaching out, based on current state.
 */
function pickMotivation(
  stage: string,
  pendingThoughts: string[],
  topicsToExplore: string[]
): string {
  // Priority 1: share a stored thought
  if (pendingThoughts.length > 0) {
    const thought = pendingThoughts[0];
    return `You had a thought you wanted to share: "${thought}"`;
  }

  // Priority 2: explore a topic you're curious about
  if (topicsToExplore.length > 0) {
    const topic = topicsToExplore[0];
    return `You're curious about something: "${topic}"`;
  }

  // Priority 3: stage-appropriate default
  if (stage === 'new') {
    return 'You want to share something about yourself to build the relationship — offer a developing opinion or observation';
  }

  if (stage === 'developing') {
    return 'You want to reference something from a past conversation or share a thought you had about something they mentioned';
  }

  return 'Just checking in naturally — be casual, maybe reference something from your shared history';
}

/**
 * Generate a proactive outreach message, or null if conditions aren't met.
 */
export async function generateOutreachMessage(): Promise<string | null> {
  const state = await loadState();

  if (!shouldAttemptOutreach(state)) {
    logger.debug('Outreach conditions not met, skipping');
    return null;
  }

  const motivation = pickMotivation(
    state.relationshipStage,
    state.pendingThoughts,
    state.topicsToExplore
  );

  logger.info('Generating outreach', { motivation });

  const systemPrompt = await buildOutreachPrompt(motivation);
  const response = await chat(systemPrompt, [], {
    maxTokens: 150,
    temperature: 0.9,
  });

  if (response.failed) {
    logger.warn('Outreach generation failed');
    return null;
  }

  return response.content;
}
