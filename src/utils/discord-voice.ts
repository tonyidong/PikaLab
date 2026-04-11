import { Client, TextChannel, DMChannel } from 'discord.js';
import { getAudioDuration, generateWaveform } from './audio.js';
import { logger } from './logger.js';

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Send an OGG audio buffer as a native Discord voice message
 * using the raw REST API (discord.js doesn't support this natively).
 */
export async function sendVoiceMessage(
  client: Client,
  channel: TextChannel | DMChannel,
  oggBuffer: Buffer,
): Promise<boolean> {
  const token = client.token;
  if (!token) return false;

  try {
    const duration = await getAudioDuration(oggBuffer);
    const waveform = generateWaveform(oggBuffer);

    // Step 1: Request an upload URL
    const uploadReq = await fetch(`${DISCORD_API}/channels/${channel.id}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: [{ filename: 'voice-message.ogg', file_size: oggBuffer.length, id: '0' }],
      }),
    });

    if (!uploadReq.ok) {
      logger.error(`Upload URL request failed: ${uploadReq.status} ${await uploadReq.text()}`);
      return false;
    }

    const uploadData = await uploadReq.json() as {
      attachments: Array<{ id: string; upload_url: string; upload_filename: string }>;
    };
    const { upload_url, upload_filename } = uploadData.attachments[0];

    // Step 2: Upload the file
    const putRes = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/ogg' },
      body: new Uint8Array(oggBuffer),
    });

    if (!putRes.ok) {
      logger.error(`File upload failed: ${putRes.status}`);
      return false;
    }

    // Step 3: Send the message with voice message flags
    const msgRes = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        flags: 1 << 13, // IS_VOICE_MESSAGE
        attachments: [
          {
            id: '0',
            filename: 'voice-message.ogg',
            uploaded_filename: upload_filename,
            duration_secs: duration,
            waveform,
          },
        ],
      }),
    });

    if (!msgRes.ok) {
      logger.error(`Voice message send failed: ${msgRes.status} ${await msgRes.text()}`);
      return false;
    }

    logger.info(`Sent voice message (${duration}s)`);
    return true;
  } catch (err) {
    logger.error('sendVoiceMessage failed', err);
    return false;
  }
}
