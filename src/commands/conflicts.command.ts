/**
 * conflicts.command.ts — lists merge conflicts from in-progress merge state.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { requireMergeState } from '../core/merge/merge-state.js';
import { conflictDescription } from '../core/merge/tree-merge.js';
import { withHistoryAction } from '../cli/with-history.js';

export function registerConflictsCommand(program: Command): void {
  program
    .command('conflicts')
    .description('List merge conflicts during an in-progress merge')
    .action(
      withHistoryAction('conflicts', async () => {
        const repo = Repository.open();
        const state = await requireMergeState(repo.rootDir, 'Merge');

        const unresolved = state.conflicts.filter((entry) => !entry.resolved);
        const resolved = state.conflicts.filter((entry) => entry.resolved);

        console.log(`Merge in progress: ${state.currentBranch} ← ${state.incomingBranch}`);
        console.log();

        if (state.conflicts.length === 0) {
          console.log('No conflicts recorded.');
          return;
        }

        if (unresolved.length > 0) {
          console.log(`Unresolved (${unresolved.length}):`);
          for (const conflict of unresolved) {
            const description = conflictDescription({
              path: conflict.path,
              conflictType: conflict.type,
              baseHash: conflict.baseHash,
              ourHash: conflict.ourHash,
              theirHash: conflict.theirHash,
            });
            console.log(`  ${conflict.path.padEnd(24)}${description}`);
          }
        }

        if (resolved.length > 0) {
          if (unresolved.length > 0) {
            console.log();
          }
          console.log(`Resolved (${resolved.length}):`);
          for (const conflict of resolved) {
            console.log(`  ${conflict.path}`);
          }
        }
      }),
    );
}
