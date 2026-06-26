/**
 * atomic-write.ts — crash-safe file writing via write-then-rename.
 */

import { readFile, writeFile as fsWriteFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureDir } from './file-system.js';

/**
 * atomicWrite — writes a full file atomically (temp file, then rename).
 */
export async function atomicWrite(path: string, content: string | Buffer): Promise<void> {
  const dir = dirname(path);
  await ensureDir(dir);

  const tmp = join(dir, `.${randomBytes(8).toString('hex')}.tmp`);

  try {
    await fsWriteFile(tmp, content);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * atomicAppendLine — appends one line by rewriting the file atomically.
 * Avoids leaving a half-written line if the process crashes mid-append.
 */
export async function atomicAppendLine(path: string, line: string): Promise<void> {
  let existing = '';

  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }

  const normalized = existing.endsWith('\n') || existing.length === 0 ? existing : `${existing}\n`;
  await atomicWrite(path, `${normalized}${line}\n`);
}
