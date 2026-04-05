import type { RelationalState } from '../brain/state.js';

const BASE_INTERVALS: Record<RelationalState['relationshipStage'], number> = {
  new: 2 * 60 * 60 * 1000, // 2 hours
  developing: 8 * 60 * 60 * 1000, // 8 hours
  established: 24 * 60 * 60 * 1000, // 24 hours
};

/**
 * Calculate how long to wait before the next outreach attempt.
 * Factors in: relationship stage, failed attempts, response rate, and jitter.
 */
export function calculateOutreachInterval(state: RelationalState): number {
  let interval = BASE_INTERVALS[state.relationshipStage];

  // Exponential backoff for unanswered outreach
  if (state.outreachAttemptsSinceResponse >= 1) {
    interval *= Math.pow(2, state.outreachAttemptsSinceResponse);
  }

  // Further increase if owner generally doesn't respond much
  if (state.ownerResponseRate < 0.5) {
    interval *= 2;
  }

  // Add ±20% jitter so timing doesn't feel robotic
  const jitter = interval * 0.2 * (Math.random() * 2 - 1);
  return interval + jitter;
}

/**
 * Should the bot attempt to reach out right now?
 */
export function shouldAttemptOutreach(state: RelationalState): boolean {
  // Hard stop: never reach out if ignored 3+ times in a row
  if (state.outreachAttemptsSinceResponse >= 3) return false;

  // Don't reach out if we've never spoken (no lastOwnerMessage)
  if (!state.lastOwnerMessage) return false;

  // Check timing
  const now = Date.now();
  const lastOutreach = state.lastBotOutreach
    ? new Date(state.lastBotOutreach).getTime()
    : 0;
  const timeSinceOutreach = now - lastOutreach;
  const requiredInterval = calculateOutreachInterval(state);

  return timeSinceOutreach >= requiredInterval;
}

/**
 * Update response rate with exponential moving average.
 * Called when owner responds (responded=true) or when outreach goes unanswered.
 */
export function updateResponseRate(
  state: RelationalState,
  responded: boolean
): number {
  const alpha = 0.3; // weight of new observation
  const newRate = responded ? 1.0 : 0.0;
  return state.ownerResponseRate * (1 - alpha) + newRate * alpha;
}
