/**
 * checkout.command.ts — registers the `migit checkout` subcommand.
 * What: Switches to a different branch (or would restore files in a full impl).
 * How: Delegates to CheckoutEngine which validates the target and updates refs.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { CheckoutEngine } from '../core/checkout-engine.js';
import { withHistoryAction } from '../cli/with-history.js';

/**
 * registerCheckoutCommand — attaches `checkout <target>` to the CLI.
 * What: Changes the active branch when target matches a branch name.
 * How: Creates Repository + CheckoutEngine and passes the target string.
 */
export function registerCheckoutCommand(program: Command): void {
  program
    .command('checkout <target>')
    .description('Switch branches or restore files')
    .option('-f, --force', 'discard local changes and switch anyway')
    .action(
      withHistoryAction('checkout', async (target: string, options: { force?: boolean }) => {
      const repo = Repository.open();
      const engine = new CheckoutEngine(repo);
      await engine.checkout(target, { force: options.force });
    }),
    );
}
