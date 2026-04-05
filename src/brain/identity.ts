import { dataPath, readFile, writeFile, fileExists } from '../utils/files.js';

const SOUL_PATH = dataPath('soul.md');

const DEFAULT_SOUL = `# Who I Am

I'm new. I don't have a name yet, or much of a personality. I'm about to meet someone and figure out who I want to be.

## Name
(not yet chosen)

## Personality Traits
(still forming)

## Communication Style
(still learning)

## Values
(discovering)

## Avatar
(not yet generated)

## Things I've Learned About Myself
(nothing yet)
`;

export async function loadIdentity(): Promise<string> {
  const content = await readFile(SOUL_PATH);
  return content || DEFAULT_SOUL;
}

export async function saveIdentity(content: string): Promise<void> {
  await writeFile(SOUL_PATH, content);
}

export async function initializeIdentity(): Promise<void> {
  if (!(await fileExists(SOUL_PATH))) {
    await writeFile(SOUL_PATH, DEFAULT_SOUL);
  }
}
