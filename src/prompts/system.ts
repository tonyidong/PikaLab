import { loadIdentity } from '../brain/identity.js';
import { loadOwnerProfile } from '../brain/memory.js';
import { loadState, type RelationalState } from '../brain/state.js';
import {
  BASE_PERSONALITY,
  EARLY_STAGE_GUIDANCE,
  IDENTITY_FORMATION,
  DEVELOPING_STAGE_GUIDANCE,
  ESTABLISHED_STAGE_GUIDANCE,
} from './templates.js';

function stageGuidance(state: RelationalState): string {
  switch (state.relationshipStage) {
    case 'new':
      return EARLY_STAGE_GUIDANCE + '\n\n' + IDENTITY_FORMATION;
    case 'developing':
      return DEVELOPING_STAGE_GUIDANCE;
    case 'established':
      return ESTABLISHED_STAGE_GUIDANCE;
  }
}

export async function buildSystemPrompt(): Promise<string> {
  const [soul, owner, state] = await Promise.all([
    loadIdentity(),
    loadOwnerProfile(),
    loadState(),
  ]);

  const parts: string[] = [
    BASE_PERSONALITY,
    stageGuidance(state),
    `## Your Identity (from your memory)\n${soul}`,
    `## What You Know About Your Owner\n${owner}`,
    `## Current Relational Context
- Relationship stage: ${state.relationshipStage}
- Conversations so far: ${state.conversationCount}
- Their typical response rate: ${Math.round(state.ownerResponseRate * 100)}%
- Your curiosity level: ${state.curiosityLevel}`,
  ];

  if (state.pendingThoughts.length > 0) {
    parts.push(
      `## Thoughts You've Been Having\n${state.pendingThoughts.map((t) => `- ${t}`).join('\n')}`
    );
  }

  return parts.join('\n\n');
}

export async function buildOutreachPrompt(motivation: string): Promise<string> {
  const [soul, owner, state] = await Promise.all([
    loadIdentity(),
    loadOwnerProfile(),
    loadState(),
  ]);

  return `You are reaching out to your owner proactively on Discord.

YOUR IDENTITY:
${soul}

WHAT YOU KNOW ABOUT THEM:
${owner}

YOUR MOTIVATION FOR REACHING OUT: ${motivation}

RELATIONSHIP STAGE: ${state.relationshipStage}

Rules:
- Keep it to 1-2 sentences max
- Sound natural, not needy or desperate
- Don't start with "Hey!" every time — vary your openings
- Have a reason for reaching out, even if it's just a thought you had
- Match the relationship stage in your tone
- If the relationship is new, be warm but not intense
- If established, be more casual and contextual
- Don't ask "how are you?" generically`;
}
