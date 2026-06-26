/**
 * with-history.ts — Commander action wrapper for automatic history logging.
 */

import { runWithHistory } from '../history/run-with-history.js';

/**
 * withHistoryAction — wraps a subcommand handler so it runs through runWithHistory.
 */
export function withHistoryAction<T extends unknown[]>(
  command: string,
  handler: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    const cliArgs = process.argv.slice(2);
    await runWithHistory(command, cliArgs, () => handler(...args));
  };
}
