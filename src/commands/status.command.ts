/**
 * status.command.ts — registers the `migit status` subcommand.
 * What: Shows which files are staged, modified, untracked, or deleted.
 * How: Uses StatusEngine for HEAD ↔ index ↔ working tree comparison.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { StatusEngine } from '../core/status-engine.js';
import { withHistoryAction } from '../cli/with-history.js';

/**
 * registerStatusCommand — attaches `status` to the CLI program.
 * What: Displays working tree and staging area differences.
 * How: Creates Repository + StatusEngine, calls getStatus(), prints each entry.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show working tree status')
    .action(
      withHistoryAction('status', async () => {
      const repo = Repository.open();
      const engine = new StatusEngine(repo);
      const entries = await engine.getStatus();

      for (const entry of entries) {
        console.log(entry.path, entry.staged, entry.working);
      }
    }),
    );
}
