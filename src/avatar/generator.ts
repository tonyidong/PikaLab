import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import { loadIdentity } from '../brain/identity.js';
import { loadState, saveState } from '../brain/state.js';
import { dataPath } from '../utils/files.js';
import { logger } from '../utils/logger.js';
import { getClient } from '../index.js';

const AVATAR_PATH = dataPath('avatar.png');

export async function generateAvatar(): Promise<void> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const soul = await loadIdentity();

    const prompt = `Generate a stylized, friendly avatar/profile picture for a character with this personality. Not photorealistic — more like a clean, modern digital illustration. Simple background, suitable as a small Discord profile picture.

Personality description:
${soul}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: prompt,
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const buffer = Buffer.from(part.inlineData.data, 'base64');
        await fs.writeFile(AVATAR_PATH, buffer);

        // Try to update Discord bot avatar
        try {
          const client = getClient();
          await client.user?.setAvatar(buffer);
          logger.info('Discord avatar updated');
        } catch (err) {
          logger.warn('Could not set Discord avatar (non-fatal)', err);
        }

        // Mark as generated
        const state = await loadState();
        state.avatarGenerated = true;
        await saveState(state);

        logger.info('Avatar generated and saved');
        return;
      }
    }

    logger.warn('Gemini image response contained no image data');
  } catch (err) {
    logger.error('Avatar generation failed', err);
    // Non-fatal — bot continues without avatar, tries again next reflection
  }
}
