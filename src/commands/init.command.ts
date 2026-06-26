/**
 * init.command.ts — registers the `migit init` subcommand.
 * What: Creates a new empty migit repository in the current directory.
 * How: Uses Commander to define the command and Repository.init() for setup.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { withHistoryAction } from '../cli/with-history.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new migit repository')
    .option('-n, --name <name>', 'author name for commits')
    .option('-e, --email <email>', 'author email for commits')
    .option('-f, --force', 'reinitialize an existing repository and clear history')
    .action(
      withHistoryAction('init', async (options: { name?: string; email?: string; force?: boolean }) => {
      const repo = Repository.at(process.cwd());
      const result = await repo.init({
        userName: options.name,
        userEmail: options.email,
        force: options.force,
      });
      const config = await repo.configStore.load();
      if (result === 'reinitialized') {
        console.log('Reinitialized migit repository (history cleared)');
      } else {
        console.log('Initialized empty migit repository');
      }
      console.log(`Author: ${config.user.name} <${config.user.email}>`);
    }),
    );
}
