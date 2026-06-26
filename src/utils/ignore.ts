/**
 * ignore.ts — sensitive-file checks and ignore-rule helpers.
 */

import { IgnoreRules } from './ignore-rules.js';
import { isSensitiveFile } from './sensitive-files.js';

export { isSensitiveFile } from './sensitive-files.js';

/**
 * shouldIgnorePath — true when path matches .migitignore or built-in rules.
 */
export async function shouldIgnorePath(
  rootDir: string,
  relativePath: string,
  isDirectory = false,
): Promise<boolean> {
  const rules = await IgnoreRules.load(rootDir);
  return rules.isIgnored(relativePath, isDirectory);
}

/** @deprecated Use shouldIgnorePath() — sync fallback for always-ignored paths only. */
export function shouldIgnore(relativePath: string): boolean {
  if (isSensitiveFile(relativePath)) {
    return true;
  }

  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const always = ['.migit', '.git', 'node_modules'];

  return always.some(
    (pattern) =>
      normalized === pattern ||
      normalized.startsWith(`${pattern}/`) ||
      parts.includes(pattern),
  );
}

export { IgnoreRules, DEFAULT_MIGITIGNORE, ensureDefaultMigitignore } from './ignore-rules.js';
