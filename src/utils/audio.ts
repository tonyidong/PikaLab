import { GoogleGenAI } from '@google/genai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

/**
 * Transcribe an audio buffer (any format Gemini supports) into text.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/ogg'
): Promise<string | null> {
  try {
    const base64 = audioBuffer.toString('base64');

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'Transcribe this audio message exactly as spoken. Return only the transcription, nothing else.' },
          ],
        },
      ],
    });

    const text = response.text?.trim();
    if (!text) return null;

    logger.info(`Transcribed audio: "${text.slice(0, 80)}"`);
    return text;
  } catch (err) {
    logger.error('Audio transcription failed', err);
    return null;
  }
}

/**
 * Convert text to speech using Gemini TTS, returning an OGG Opus buffer
 * suitable for Discord voice messages.
 */
export async function textToSpeech(text: string): Promise<Buffer | null> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
        const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
        const oggBuffer = await wavToOgg(wavBuffer);
        return oggBuffer;
      }
    }

    logger.warn('TTS returned no audio data');
    return null;
  } catch (err) {
    logger.error('Text-to-speech failed', err);
    return null;
  }
}

/**
 * Wrap raw PCM data in a WAV header.
 */
function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitDepth: number
): Buffer {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);         // PCM chunk size
  header.writeUInt16LE(1, 20);          // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Convert WAV to OGG Opus using ffmpeg.
 */
async function wavToOgg(wavBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const wavPath = path.join(tmpDir, `pika-${Date.now()}.wav`);
  const oggPath = path.join(tmpDir, `pika-${Date.now()}.ogg`);

  try {
    await fs.writeFile(wavPath, wavBuffer);
    await execFileAsync('ffmpeg', [
      '-y', '-i', wavPath,
      '-c:a', 'libopus', '-b:a', '64k',
      '-ar', '48000', '-ac', '1',
      oggPath,
    ]);
    const oggBuffer = await fs.readFile(oggPath);
    return oggBuffer;
  } finally {
    await fs.unlink(wavPath).catch(() => {});
    await fs.unlink(oggPath).catch(() => {});
  }
}

/**
 * Get the duration of an OGG audio buffer in seconds using ffprobe.
 */
export async function getAudioDuration(buffer: Buffer): Promise<number> {
  const tmpPath = path.join(os.tmpdir(), `pika-dur-${Date.now()}.ogg`);
  try {
    await fs.writeFile(tmpPath, buffer);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', tmpPath,
    ]);
    return Math.ceil(parseFloat(stdout.trim()) || 1);
  } catch {
    return 5; // fallback
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Generate a simple waveform byte array (base64) for Discord voice messages.
 * This creates a rough waveform visualization from the audio.
 */
export function generateWaveform(buffer: Buffer, samples: number = 256): string {
  const step = Math.max(1, Math.floor(buffer.length / samples));
  const waveform = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    const offset = Math.min(i * step, buffer.length - 1);
    waveform[i] = Math.min(255, Math.abs(buffer[offset]));
  }
  return waveform.toString('base64');
}
