import { GoogleGenAI } from '@google/genai';
import { logger } from './logger.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

/**
 * Generate an image from a text prompt using Gemini's image model.
 * Returns the image as a Buffer, or null on failure.
 */
export async function generateImage(prompt: string): Promise<Buffer | null> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: prompt,
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        logger.info('Image generated successfully');
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }

    logger.warn('Image generation returned no image data');
    return null;
  } catch (err) {
    logger.error('Image generation failed', err);
    return null;
  }
}
