/**
 * run-with-history.ts — wraps CLI command handlers with history logging.
 */

import { HistoryLogger } from './history-logger.js';
import { sanitizeArgs, getSafeErrorMessage } from './history-sanitize.js';
import { findRepositoryRoot, getMiGitDir } from '../utils/paths.js';
import { existsSync } from '../utils/file-system.js';
import type { HistoryAppendEntry } from './history-logger.js';
import { consumeHistorySuccessExtras } from './history-context.js';

function resolveHistoryRoot(command: string): string | null {
  try {
    return findRepositoryRoot();
  } catch {
    if (command === 'init' && existsSync(getMiGitDir(process.cwd()))) {
      return process.cwd();
    }
    return null;
  }
}

async function appendHistory(command: string, entry: HistoryAppendEntry): Promise<void> {
  const rootDir = resolveHistoryRoot(command);
  if (!rootDir) {
    return;
  }

  const logger = new HistoryLogger(rootDir);
  await logger.append(entry);
}

/**
 * runWithHistory — executes a command and records success or failure.
 */
export async function runWithHistory<T>(
  command: string,
  args: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const safeArgs = sanitizeArgs(args);

  try {
    const result = await operation();

    await appendHistory(command, {
      command,
      args: safeArgs,
      status: 'success',
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      ...consumeHistorySuccessExtras(),
    });

    return result;
  } catch (error) {
    await appendHistory(command, {
      command,
      args: safeArgs,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      error: getSafeErrorMessage(error),
    });

    throw error;
  }
}
