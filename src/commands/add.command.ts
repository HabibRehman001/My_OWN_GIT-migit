/**
 * add.command.ts — registers the `migit add` subcommand.
 * What: Stages one or more files/directories into the index for the next commit.
 * How: Accepts variadic path arguments and delegates to Repository.add().
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { withHistoryAction } from '../cli/with-history.js';

/**
 * registerAddCommand — attaches `add <paths...>` to the CLI program.
 * What: Wires up file staging from the command line.
 * How: `<paths...>` means Commander collects all remaining args into a string array.
 * The action receives that array and passes it to the repository layer.
 */
export function registerAddCommand(program: Command): void {
  program
    .command('add <paths...>')
    .description('Stage files for commit')
    .action(
      withHistoryAction('add', async (paths: string[]) => {
      const repo = Repository.open();
      await repo.add(paths);
    }),
    );
}
