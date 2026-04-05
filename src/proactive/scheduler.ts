import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { generateOutreachMessage } from './motivations.js';
import { loadState, saveState } from '../brain/state.js';
import { appendMessage } from '../brain/memory.js';
import { logger } from '../utils/logger.js';

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Start the proactive outreach scheduler.
 * Checks every 30 minutes if it's time to reach out.
 */
export function startProactiveScheduler(
  client: Client,
  channelId: string
): void {
  if (scheduledTask) {
    logger.warn('Scheduler already running');
    return;
  }

  scheduledTask = cron.schedule('*/30 * * * *', async () => {
    try {
      const message = await generateOutreachMessage();

      if (!message) return; // conditions not met

      // Find the channel to send to
      const channel = await client.channels.fetch(channelId);
      if (!channel || !(channel instanceof TextChannel)) {
        logger.warn('Could not find outreach channel', { channelId });
        return;
      }

      await channel.send(message);

      // Update state
      const state = await loadState();
      state.lastBotOutreach = new Date().toISOString();
      state.outreachAttemptsSinceResponse++;

      // Consume the first pending thought if we used one
      if (state.pendingThoughts.length > 0) {
        state.pendingThoughts.shift();
      }

      await saveState(state);

      // Log the outreach message
      await appendMessage({
        role: 'bot',
        content: message,
        timestamp: new Date().toISOString(),
      });

      logger.info('Proactive outreach sent', { message: message.slice(0, 80) });
    } catch (err) {
      logger.error('Proactive outreach failed', err);
      // Fail silently — don't spam errors, try again next cycle
    }
  });

  logger.info('Proactive scheduler started (checking every 30 min)');
}

export function stopProactiveScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Proactive scheduler stopped');
  }
}
