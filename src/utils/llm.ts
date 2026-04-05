import { GoogleGenAI } from '@google/genai';
import { logger } from './logger.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const FALLBACK_MESSAGES = [
  "hmm, lost my train of thought for a sec. what were you saying?",
  "sorry, my brain glitched — can you say that again?",
  "whoa, spaced out there for a moment. one more time?",
  "haha okay something weird just happened in my head. what was that?",
];

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface LLMResponse {
  content: string;
  failed?: boolean;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function chat(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<LLMResponse> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const contents = messages.map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      }));

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro-preview-05-06',
        contents,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: options?.maxTokens ?? 300,
          temperature: options?.temperature ?? 0.85,
        },
      });

      const text = response.text?.trim();
      if (!text) throw new Error('Empty response from Gemini');

      return { content: text };
    } catch (err) {
      logger.warn(`LLM attempt ${attempt}/${maxAttempts} failed`, err);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  logger.error('All LLM attempts failed, using fallback');
  return { content: pickRandom(FALLBACK_MESSAGES), failed: true };
}

/**
 * Structured chat — asks the LLM to return JSON.
 * Parses the response and returns the object, or null on failure.
 */
export async function chatJSON<T>(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<T | null> {
  const response = await chat(systemPrompt, messages, options);
  if (response.failed) return null;

  try {
    // Strip markdown code fences if present
    let raw = response.content;
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn('Failed to parse LLM JSON response', { error: err, content: response.content });
    return null;
  }
}
