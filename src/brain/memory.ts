import { dataPath, readFile, writeFile, fileExists, readJSON, writeJSON } from '../utils/files.js';
import { logger } from '../utils/logger.js';

const OWNER_PATH = dataPath('owner.md');
const LOG_PATH = dataPath('conversation_log.json');
const MAX_LOG_MESSAGES = 50;

const DEFAULT_OWNER = `# My Owner

I haven't met them yet.

## Basic Info
(unknown)

## What They Care About
(unknown)

## Our Relationship
Just starting out.

## Important Memories
(none yet)

## Things to Remember
(none yet)

## Conversational Preferences
(still learning)
`;

// --- Owner Profile ---

export async function loadOwnerProfile(): Promise<string> {
  const content = await readFile(OWNER_PATH);
  return content || DEFAULT_OWNER;
}

export async function saveOwnerProfile(content: string): Promise<void> {
  await writeFile(OWNER_PATH, content);
}

export async function initializeOwnerProfile(): Promise<void> {
  if (!(await fileExists(OWNER_PATH))) {
    await writeFile(OWNER_PATH, DEFAULT_OWNER);
  }
}

// --- Conversation Log ---

export interface LogMessage {
  role: 'owner' | 'bot';
  content: string;
  timestamp: string;
}

interface ConversationLog {
  messages: LogMessage[];
}

export async function loadConversationLog(): Promise<LogMessage[]> {
  const log = await readJSON<ConversationLog>(LOG_PATH);
  return log?.messages ?? [];
}

export async function appendMessage(msg: LogMessage): Promise<void> {
  const messages = await loadConversationLog();
  messages.push(msg);

  // Keep only the last N messages
  const trimmed = messages.slice(-MAX_LOG_MESSAGES);
  await writeJSON(LOG_PATH, { messages: trimmed });
}

export async function clearConversationLog(): Promise<void> {
  await writeJSON(LOG_PATH, { messages: [] });
}
