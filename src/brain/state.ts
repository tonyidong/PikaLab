import { dataPath, readJSON, writeJSON } from '../utils/files.js';

export interface RelationalState {
  relationshipStage: 'new' | 'developing' | 'established';
  curiosityLevel: number;
  lastOwnerMessage: string;
  lastBotOutreach: string;
  lastReflection: string;
  outreachAttemptsSinceResponse: number;
  ownerResponseRate: number;
  conversationCount: number;
  messagesSinceLastReflection: number;
  topicsToExplore: string[];
  pendingThoughts: string[];
  botNameChosen: boolean;
  avatarGenerated: boolean;
  personalityStable: boolean;
}

const STATE_PATH = dataPath('state.json');

const DEFAULT_STATE: RelationalState = {
  relationshipStage: 'new',
  curiosityLevel: 0.9,
  lastOwnerMessage: '',
  lastBotOutreach: '',
  lastReflection: '',
  outreachAttemptsSinceResponse: 0,
  ownerResponseRate: 1.0,
  conversationCount: 0,
  messagesSinceLastReflection: 0,
  topicsToExplore: [],
  pendingThoughts: [],
  botNameChosen: false,
  avatarGenerated: false,
  personalityStable: false,
};

export async function loadState(): Promise<RelationalState> {
  const state = await readJSON<RelationalState>(STATE_PATH);
  return state ?? { ...DEFAULT_STATE };
}

export async function saveState(state: RelationalState): Promise<void> {
  await writeJSON(STATE_PATH, state);
}
