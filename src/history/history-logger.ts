/**
 * history-logger.ts — appends executed commands to the history log file.
 */

import { atomicAppendLine } from '../utils/atomic-write.js';
import { getHistoryPath } from '../utils/paths.js';

export interface HistoryAppendEntry {
  command: string;
  args: string[];
  status: 'success' | 'failed';
  durationMs: number;
  timestamp: string;
  error?: string;
  /** Set when a maintainer bypasses branch policy (e.g. commit --override-policy). */
  policyOverride?: boolean;
  /** Active branch when policyOverride was recorded. */
  branch?: string;
}

/** Structured entry written by HistoryLogger.append (since v0.2). */
export interface HistoryEntry extends HistoryAppendEntry {}

/** @deprecated Legacy single-field entries still readable from old logs. */
export interface LegacyHistoryEntry {
  timestamp: string;
  command: string;
}

/**
 * HistoryLogger — writes command history entries to disk.
 */
export class HistoryLogger {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * append — records one command execution (success or failure).
   */
  async append(entry: HistoryAppendEntry): Promise<void> {
    const path = getHistoryPath(this.rootDir);
    await atomicAppendLine(path, JSON.stringify(entry));
  }

  /** @deprecated Use append() via runWithHistory instead. */
  async log(command: string): Promise<void> {
    await this.append({
      command,
      args: [command],
      status: 'success',
      durationMs: 0,
      timestamp: new Date().toISOString(),
    });
  }
}
