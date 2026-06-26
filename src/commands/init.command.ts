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
    .action(
      withHistoryAction('init', async (options: { name?: string; email?: string }) => {
      const repo = Repository.at(process.cwd());
      await repo.init({
        userName: options.name,
        userEmail: options.email,
      });
      const config = await repo.configStore.load();
      console.log('Initialized empty migit repository');
      console.log(`Author: ${config.user.name} <${config.user.email}>`);
    }),
    );
}
