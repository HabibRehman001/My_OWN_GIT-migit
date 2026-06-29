/**
 * resolve.command.ts — registers the `migit resolve` subcommand.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { MergeResolveEngine } from '../core/merge/merge-resolve.js';
import { withHistoryAction } from '../cli/with-history.js';

export function registerResolveCommand(program: Command): void {
  program
    .command('resolve <paths...>')
    .description('Mark merge conflicts as resolved after editing conflicted files')
    .action(
      withHistoryAction('resolve', async (paths: string[]) => {
        const repo = Repository.open();
        const engine = new MergeResolveEngine(repo);
        const results = await engine.resolve(paths);

        for (const result of results) {
          console.log(`Resolved ${result.path}`);
        }

        const remaining = results.at(-1)?.remainingConflicts ?? 0;
        console.log();
        if (remaining === 0) {
          console.log('All conflicts resolved.');
          console.log('Run "migit merge --continue" to complete the merge.');
        } else {
          console.log(
            `${remaining} conflict${remaining === 1 ? '' : 's'} remaining.`,
          );
        }
      }),
    );
}
