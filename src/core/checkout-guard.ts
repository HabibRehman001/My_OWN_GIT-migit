/**
 * checkout-guard.ts — dirty working tree checks before branch switches.
 */

import type { StatusEntry } from '../types/index.js';

/**
 * findCheckoutBlockers — paths that must be resolved before checkout.
 *
 * Blocks:
 * - staged changes (HEAD ≠ index)
 * - unstaged changes on tracked files (index ≠ working)
 * - untracked files that exist on the target branch (would be overwritten)
 */
export function findCheckoutBlockers(
  status: StatusEntry[],
  targetTree: Map<string, string>,
): string[] {
  const blockers: string[] = [];

  for (const entry of status) {
    if (shouldBlockCheckout(entry, targetTree)) {
      blockers.push(entry.path);
    }
  }

  return blockers.sort((a, b) => a.localeCompare(b));
}

function shouldBlockCheckout(entry: StatusEntry, targetTree: Map<string, string>): boolean {
  if (entry.staged !== null) {
    return true;
  }

  if (entry.working === 'modified' || entry.working === 'deleted') {
    return true;
  }

  if (entry.working === 'untracked' && targetTree.has(entry.path)) {
    return true;
  }

  return false;
}

export function formatCheckoutBlockedMessage(paths: string[]): string {
  return [
    'Checkout stopped.',
    '',
    'The following files would be overwritten:',
    ...paths.map((path) => `  ${path}`),
    '',
    'Commit, stage, or remove these changes before switching branches.',
  ].join('\n');
}
