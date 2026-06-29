/**
 * merge-guard.ts — block dangerous operations while a merge is in progress.
 */

import { isMergeInProgress } from './merge-state.js';
import { MiGitError } from '../../utils/errors.js';

/** Guidance shown when a blocked command runs during an active merge. */
export function formatMergeInProgressGuidance(): string {
  return [
    'A merge is currently in progress.',
    '',
    'Resolve the conflicts and run:',
    '  migit merge --continue',
    '',
    'Or cancel it with:',
    '  migit merge --abort',
  ].join('\n');
}

function assertNotDuringMerge(rootDir: string, prefix: string | null): void {
  if (!isMergeInProgress(rootDir)) {
    return;
  }

  if (prefix === null) {
    throw new MiGitError(formatMergeInProgressGuidance());
  }

  throw new MiGitError(`${prefix}\n\n${formatMergeInProgressGuidance()}`);
}

export function assertNoMergeDuringCommit(rootDir: string): void {
  assertNotDuringMerge(rootDir, null);
}

export function assertNoMergeDuringCheckout(rootDir: string): void {
  assertNotDuringMerge(rootDir, 'Checkout stopped.');
}

export function assertNoMergeDuringBranchDelete(rootDir: string): void {
  assertNotDuringMerge(rootDir, 'Branch delete stopped.');
}

export function assertNoMergeDuringMerge(rootDir: string): void {
  assertNotDuringMerge(rootDir, 'Merge stopped.');
}

/** @deprecated Use assertNoMergeDuringMerge */
export function assertNoMergeInProgress(rootDir: string): void {
  assertNoMergeDuringMerge(rootDir);
}
