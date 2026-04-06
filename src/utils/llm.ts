import { GoogleGenAI } from '@google/genai';
import { logger } from './logger.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export interface LLMResponse {
  content: string;
  failed?: boolean;
}

/**
 * Gemini requires strictly alternating user/model turns.
 * Merge any consecutive same-role messages into one.
 */
function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return [];

  const merged: ChatMessage[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content += '\n' + msg.content;
    } else {
      merged.push({ role: msg.role, content: msg.content });
    }
  }

  // Gemini needs the last message to be 'user' for a response
  if (merged.length > 0 && merged[merged.length - 1].role === 'model') {
    merged.push({ role: 'user', content: '(continue)' });
  }

  return merged;
}

export async function chat(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number; tools?: Record<string, unknown>[] }
): Promise<LLMResponse> {
  const maxAttempts = 3;
  const normalized = normalizeMessages(messages);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const contents = normalized.length > 0
        ? normalized.map((m) => ({
            role: m.role,
            parts: [{ text: m.content }],
          }))
        : [{ role: 'user' as const, parts: [{ text: 'Begin.' }] }];

      const config: Record<string, unknown> = {
        systemInstruction: systemPrompt,
        maxOutputTokens: options?.maxTokens ?? 300,
        temperature: options?.temperature ?? 0.85,
      };

      if (options?.tools && options.tools.length > 0) {
        config.tools = options.tools;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents,
        config,
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
  return {
    content: "hmm, lost my train of thought for a sec. what were you saying?",
    failed: true,
  };
}

/**
 * Structured chat — asks the LLM to return JSON.
 */
export async function chatJSON<T>(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<T | null> {
  const response = await chat(systemPrompt, messages, options);
  if (response.failed) return null;

  try {
    let raw = response.content;
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn('Failed to parse LLM JSON response', { error: err, content: response.content });
    return null;
  }
}
