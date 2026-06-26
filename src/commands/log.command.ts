/**
 * log.command.ts — registers the `migit log` subcommand.
 * What: Prints commit history starting from HEAD, walking parent chain.
 * How: Repository.log() traverses commits; this command formats and prints them.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { withHistoryAction } from '../cli/with-history.js';

/**
 * registerLogCommand — attaches `log` with optional commit limit to the CLI.
 * What: Shows recent commits in reverse chronological order (newest first).
 * How: `-n/--max-count` limits how many commits to display (default 10).
 */
export function registerLogCommand(program: Command): void {
  program
    .command('log')
    .description('Show commit history')
    .option('-n, --max-count <count>', 'limit number of commits', '10')
    .action(
      withHistoryAction('log', async (options: { maxCount: string }) => {
      const repo = Repository.open();
      const commits = await repo.log(parseInt(options.maxCount, 10));

      for (const commit of commits) {
        console.log(`commit ${commit.hash}`);
        console.log(`Author: ${commit.author}`);
        console.log(`Date:   ${new Date(commit.timestamp).toISOString()}`);
        console.log();
        console.log(`    ${commit.message}`);
        console.log();
      }
    }),
    );
}
