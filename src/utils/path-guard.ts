/**
 * path-guard.ts — keep all repository operations inside the repo root.
 */

import { resolve, relative, sep } from 'node:path';
import { MiGitError } from './errors.js';

/**
 * resolvePathInRepository — resolves user input and rejects paths outside rootDir.
 */
export function resolvePathInRepository(rootDir: string, inputPath: string): string {
  if (!inputPath || inputPath.includes('\0')) {
    throw new MiGitError(`Invalid path: "${inputPath}"`);
  }

  const root = resolve(rootDir);
  const resolved = resolve(root, inputPath);

  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new MiGitError(`Path "${inputPath}" is outside the repository root`);
  }

  return resolved;
}

/** Repository-relative POSIX path from an absolute path under rootDir. */
export function toRepositoryRelativePath(rootDir: string, absolutePath: string): string {
  const rel = relative(resolve(rootDir), absolutePath);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new MiGitError('Path escapes the repository root');
  }
  return rel.replace(/\\/g, '/');
}
