/**
 * file-system.ts — thin async wrappers around Node.js filesystem APIs.
 * What: Provides read/write/mkdir helpers used across the entire codebase.
 * How: Delegates to `node:fs/promises` and `node:fs`, adding ensureDir on writes.
 * Centralizing here means every module shares the same I/O behavior.
 */

import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir, appendFile as fsAppendFile, unlink as fsUnlink, readdir as fsReaddir } from 'node:fs/promises';
import { existsSync as fsExistsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * readFile — reads a file and returns its contents as a Buffer.
 * What: Async file read used by object store, index, scanners, etc.
 * How: Delegates directly to fs.promises.readFile without encoding (binary-safe).
 */
export async function readFile(path: string): Promise<Buffer> {
  return fsReadFile(path);
}

/**
 * writeFile — writes a Buffer to disk, creating parent directories first.
 * What: Persists data (index, refs, objects) safely.
 * How: Calls ensureDir on the parent folder, then fsWriteFile with the buffer.
 */
export async function writeFile(path: string, data: Buffer): Promise<void> {
  // Create parent directories if they don't exist (e.g. objects/ab/ for hash abcd...).
  await ensureDir(dirname(path));
  await fsWriteFile(path, data);
}

/**
 * appendFile — appends a UTF-8 string to the end of a file.
 * What: Used by history logger to add one JSON line per command.
 * How: Ensures parent dir exists, then calls fs appendFile.
 */
export async function appendFile(path: string, data: string): Promise<void> {
  await ensureDir(dirname(path));
  await fsAppendFile(path, data);
}

/**
 * ensureDir — creates a directory and all missing parents recursively.
 * What: Guarantees a folder exists before we write a file inside it.
 * How: mkdir with `{ recursive: true }` — no error if dir already exists.
 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * existsSync — checks synchronously whether a path exists on disk.
 * What: Quick guard before operations that require a repo (e.g. doctor, assertInitialized).
 * How: Wraps Node's fs.existsSync for a boolean result.
 */
export function existsSync(path: string): boolean {
  return fsExistsSync(path);
}

/**
 * unlink — deletes a file asynchronously.
 * What: Removes branch ref files or cleans up temp files.
 * How: Delegates to fs.promises.unlink.
 */
export async function unlink(path: string): Promise<void> {
  await fsUnlink(path);
}

/**
 * readdir — lists filenames in a directory.
 * What: Used to iterate object shards, branch names, project files.
 * How: Delegates to fs.promises.readdir (returns string array of entry names).
 */
export async function readdir(path: string): Promise<string[]> {
  return fsReaddir(path);
}

// Re-export stat from fs/promises so callers can check file vs directory type.
export { stat } from 'node:fs/promises';
