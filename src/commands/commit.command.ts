/**
 * commit.command.ts — registers the `migit commit` subcommand.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { generateSmartCommitMessage } from '../ai/smart-commit.js';
import { withHistoryAction } from '../cli/with-history.js';
import { confirmCommitMessage } from '../utils/prompt-confirm.js';
import { MiGitError } from '../utils/errors.js';

export function registerCommitCommand(program: Command): void {
  program
    .command('commit')
    .description('Record changes to the repository')
    .option('-m, --message <message>', 'commit message')
    .option('--smart', 'generate commit message with Gemini')
    .option('--paths-only', 'with --smart, send only file paths (no diff metadata)')
    .option('-y, --yes', 'with --smart, skip commit message confirmation')
    .action(
      withHistoryAction(
        'commit',
        async (options: {
          message?: string;
          smart?: boolean;
          pathsOnly?: boolean;
          yes?: boolean;
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

          const hash = await repo.commit(message.trim());
          console.log(`[commit ${hash.slice(0, 7)}] ${message.trim()}`);
        },
      ),
    );
}
