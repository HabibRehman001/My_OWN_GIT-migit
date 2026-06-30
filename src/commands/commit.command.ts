/**
 * commit.command.ts — registers the `migit commit` subcommand.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { formatCommitFileChange, listCommitFiles } from '../core/commit-files.js';
import { generateSmartCommitMessage } from '../ai/smart-commit.js';
import { withHistoryAction } from '../cli/with-history.js';
import { confirmCommitMessage } from '../utils/prompt-confirm.js';
import { MiGitError } from '../utils/errors.js';
import {
  collectCommitPolicyWarnings,
  formatPolicyWarnings,
} from '../utils/branch-policy.js';
import {
  collectOwnershipWarnings,
  formatOwnershipWarnings,
} from '../utils/ownership-warnings.js';
import { setHistorySuccessExtras } from '../history/history-context.js';

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('Record changes to the repository')
    .option('-m, --message <message>', 'commit message')
    .option('--smart', 'generate commit message with Gemini')
    .option('--paths-only', 'with --smart, send only file paths (no diff metadata)')
    .option('-y, --yes', 'with --smart, skip commit message confirmation')
    .option('--override-policy', 'allow direct commits to protected branches (maintainer override)')
    .action(
      withHistoryAction(
        'commit',
        async (options: {
          message?: string;
          smart?: boolean;
          pathsOnly?: boolean;
          yes?: boolean;
          overridePolicy?: boolean;
        }) => {
          const repo = Repository.open();
          let message = options.message;

          if (options.smart) {
            const result = await generateSmartCommitMessage(repo, {
              pathsOnly: options.pathsOnly,
            });

            if (result.usedFallback) {
              console.log('Using fallback commit message (AI unavailable or invalid response).');
            }

            message = result.message;

            if (!options.yes) {
              const confirmed = await confirmCommitMessage(message);
              if (!confirmed) {
                throw new MiGitError('Commit aborted');
              }
            }
          }

          if (!message?.trim()) {
            throw new Error('Provide -m "message" or use --smart');
          }

          const committedFiles = await listCommitFiles(repo);
          if (committedFiles.length === 0) {
            throw new MiGitError(
              'Nothing to commit — staged files match the last commit. ' +
                'Change files and run "migit add", or use "migit init --force" to start fresh.',
            );
          }

          const policy = await repo.policyStore.load();
          const policyWarnings = collectCommitPolicyWarnings(committedFiles.length, policy);
          if (policyWarnings.length > 0) {
            console.log(formatPolicyWarnings(policyWarnings));
            console.log();
          }

          const branch = await repo.getCurrentBranch();
          const ownership = await repo.ownershipStore.load();
          const ownershipWarnings = collectOwnershipWarnings(
            branch,
            committedFiles.map((change) => change.path),
            ownership,
          );
          const ownershipMessage = formatOwnershipWarnings(branch, ownershipWarnings);
          if (ownershipMessage) {
            console.log(ownershipMessage);
            console.log();
          }

          if (options.overridePolicy) {
            setHistorySuccessExtras({ policyOverride: true, branch });
          }

          const hash = await repo.commit(message.trim(), {
            overridePolicy: options.overridePolicy,
          });
          console.log(`[commit ${hash.slice(0, 7)}] ${message.trim()}`);
          for (const change of committedFiles) {
            console.log(formatCommitFileChange(change));
          }
        },
      ),
    );
}
