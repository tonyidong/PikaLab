import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

const DATA_DIR = process.env.BOT_DATA_DIR || './data';

export function dataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readFile(filepath: string): Promise<string> {
  try {
    return await fs.readFile(filepath, 'utf-8');
  } catch {
    return '';
  }
}

export async function writeFile(filepath: string, content: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content, 'utf-8');
  } catch (err) {
    logger.error(`Failed to write ${filepath}`, err);
  }
}

export async function readJSON<T>(filepath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJSON(filepath: string, data: unknown): Promise<void> {
  await writeFile(filepath, JSON.stringify(data, null, 2));
}

export async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}
