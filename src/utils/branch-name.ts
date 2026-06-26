/**
 * branch-name.ts — validates branch names before create/delete operations.
 */

import { MiGitError } from './errors.js';

const INVALID_CHARACTERS = /[~^:?*\\[\@{]/;

/**
 * validateBranchName — rejects path traversal, spaces, and invalid characters.
 */
export function validateBranchName(name: string): void {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new MiGitError('Branch name cannot be empty');
  }

  if (trimmed !== name) {
    throw new MiGitError(`Invalid branch name "${name}"`);
  }

  if (trimmed.includes(' ') || trimmed.includes('..') || trimmed.includes('\\')) {
    throw new MiGitError(`Invalid branch name "${name}"`);
  }

  if (INVALID_CHARACTERS.test(trimmed)) {
    throw new MiGitError(`Invalid branch name "${name}"`);
  }

  if (
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.') ||
    trimmed.endsWith('.lock')
  ) {
    throw new MiGitError(`Invalid branch name "${name}"`);
  }

  for (const segment of trimmed.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new MiGitError(`Invalid branch name "${name}"`);
    }
    if (segment.startsWith('.') || segment.endsWith('.lock')) {
      throw new MiGitError(`Invalid branch name "${name}"`);
    }
  }
}
