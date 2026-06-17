import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = join(__dirname, '..', '..', '..');

export function repoPath(...segments: string[]): string {
  return join(REPO_ROOT, ...segments);
}

export function listPicFiles(): string[] {
  return readdirSync(repoPath('PIC'));
}

export function readPic(name: string): Buffer {
  return readFileSync(repoPath('PIC', name));
}

export function listSndFiles(): string[] {
  return readdirSync(repoPath('SND'));
}

export function readObject(): Buffer {
  return readFileSync(repoPath('OBJECT'));
}

export function readWordsTok(): Buffer {
  return readFileSync(repoPath('WORDS.TOK'));
}
