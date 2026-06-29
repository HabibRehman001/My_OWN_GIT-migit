/**
 * merge.command.ts — registers the `migit merge` subcommand.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { MergeEngine } from '../core/merge/merge-engine.js';
import { formatMergePreview } from '../core/merge/merge-preview.js';
import { conflictDescription } from '../core/merge/tree-merge.js';
import { withHistoryAction } from '../cli/with-history.js';
import { MiGitError } from '../utils/errors.js';

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

export function registerMergeCommand(program: Command): void {
  program
    .command('merge [branch]')
    .description('Merge another branch into the current branch')
    .option('-f, --force', 'discard local changes and merge anyway')
    .option('--preview', 'show merge analysis without changing files')
    .option('--continue', 'complete an in-progress merge after resolving conflicts')
    .option('--abort', 'cancel an in-progress merge and restore the pre-merge tree')
    .action(
      withHistoryAction(
        'merge',
        async (
          branch: string | undefined,
          options: { force?: boolean; preview?: boolean; continue?: boolean; abort?: boolean },
        ) => {
        const repo = Repository.open();
        const engine = new MergeEngine(repo);

        if (options.abort) {
          if (options.continue) {
            throw new MiGitError('Merge stopped: use either --continue or --abort, not both.');
          }
          const result = await engine.abort();
          console.log('Merge aborted.');
          console.log();
          console.log(
            `Working tree restored to ${result.branch} at commit ${shortHash(result.ourCommit)}.`,
          );
          return;
        }

        if (options.continue) {
          const result = await engine.continue();
          console.log('Merge completed successfully.');
          console.log();
          console.log('Created merge commit:');
          console.log(`  ${shortHash(result.commitHash)} ${result.message}`);
          console.log();
          console.log('Parents:');
          console.log(`  ${shortHash(result.ourCommit)} ${result.branch}`);
          console.log(`  ${shortHash(result.theirCommit)} ${result.incomingBranch}`);
          return;
        }

        if (options.preview) {
          if (!branch) {
            throw new MiGitError('Merge stopped: branch name required for --preview.');
          }
          const preview = await engine.preview(branch);
          console.log(formatMergePreview(preview));
          return;
        }

        if (!branch) {
          throw new MiGitError(
            'Merge stopped: branch name required (or use --continue / --abort).',
          );
        }

        const result = await engine.merge(branch, { force: options.force });

        if (result.type === 'already-up-to-date') {
          console.log('Already up to date.');
          console.log();
          console.log(
            `All commits from ${result.sourceBranch} are already included in ${result.branch}.`,
          );
          return;
        }

        if (result.type === 'conflicts') {
          console.log('Automatic merge failed; fix conflicts and commit the result.');
          console.log();
          console.log(`${result.conflicts.length} conflict${result.conflicts.length === 1 ? '' : 's'}:`);
          for (const conflict of result.conflicts) {
            console.log(`  ${conflict.path.padEnd(24)}${conflictDescription(conflict)}`);
          }
          console.log();
          console.log('Merge paused — no commit was created.');
          console.log(`Resolve conflicts, then complete the merge when ready.`);
          return;
        }

        console.log('Fast-forward merge');
        console.log();
        console.log(`${result.branch}:`);
        console.log(`  ${shortHash(result.from)} → ${shortHash(result.to)}`);
        console.log();
        console.log(`${result.filesUpdated} file${result.filesUpdated === 1 ? '' : 's'} updated.`);
      }),
    );
}
