import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
} from 'discord.js';
import { handleMessage } from './conversation.js';
import { initializeIdentity } from './brain/identity.js';
import { initializeOwnerProfile } from './brain/memory.js';
import { loadState, saveState } from './brain/state.js';
import { ensureDataDir } from './utils/files.js';
import { startProactiveScheduler } from './proactive/scheduler.js';
import { logger } from './utils/logger.js';

// --- Validation ---
const REQUIRED_ENV = ['DISCORD_TOKEN', 'GEMINI_API_KEY', 'OWNER_DISCORD_ID'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const OWNER_ID = process.env.OWNER_DISCORD_ID!;

// --- Discord Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // needed for DM support
});

/** Exported so avatar generator can update the bot's avatar */
export function getClient(): Client {
  return client;
}

// Track the channel where the owner first messages, for proactive outreach
let ownerChannelId: string | null = null;

// --- Event Handlers ---

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`Bot online as ${readyClient.user.tag}`);

  // Initialize brain files
  await ensureDataDir();
  await initializeIdentity();
  await initializeOwnerProfile();

  // Check if we're resuming from a previous session
  const state = await loadState();
  if (state.conversationCount > 0) {
    logger.info(
      `Resuming: ${state.conversationCount} conversations, stage: ${state.relationshipStage}`
    );
  } else {
    logger.info('Fresh start — waiting for owner to initiate conversation');
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bot messages (including own)
  if (message.author.bot) return;

  // Only respond to the owner
  // Check by user ID first, fall back to username matching
  const isOwner =
    message.author.id === OWNER_ID ||
    message.author.username === OWNER_ID ||
    message.author.globalName === OWNER_ID;

  if (!isOwner) return;

  // Track the channel for proactive outreach
  if (!ownerChannelId) {
    ownerChannelId = message.channelId;

    // Start proactive scheduler now that we know which channel to use
    startProactiveScheduler(client, ownerChannelId);
    logger.info(`Owner channel set: ${ownerChannelId}`);
  }

  // Handle the message
  await handleMessage(message);
});

// --- Graceful Shutdown ---

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  client.destroy();
  process.exit(0);
});

// --- Write PID file so restarts can kill this process reliably ---
import fs from 'node:fs';
const PID_FILE = './data/.bot.pid';
fs.mkdirSync('./data', { recursive: true });
fs.writeFileSync(PID_FILE, String(process.pid));

// --- Start ---
client.login(process.env.DISCORD_TOKEN);
