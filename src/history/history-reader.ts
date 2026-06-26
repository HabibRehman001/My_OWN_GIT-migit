/**
 * history-reader.ts — loads command history from the JSONL log file.
 * What: Parses `.migit/history.log` into an array of HistoryEntry objects.
 * How: Read file → split by newlines → JSON.parse each non-empty line.
 */

import { readFile } from '../utils/file-system.js';
import { getHistoryPath } from '../utils/paths.js';
import type { HistoryEntry, LegacyHistoryEntry } from './history-logger.js';

export type HistoryLogEntry = HistoryEntry | LegacyHistoryEntry;

/**
 * HistoryReader — reads persisted command history for display or AI explanation.
 * What: Inverse of HistoryLogger — reconstructs the command timeline from disk.
 */
export class HistoryReader {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * read — returns all history entries, or [] if log file doesn't exist.
   * What: Loads the full command history for `migit history`.
   * How:
   *   1. Read history.log as UTF-8 string.
   *   2. Split on newlines, drop empty lines.
   *   3. Parse each line as JSON HistoryEntry.
   */
  async read(): Promise<HistoryLogEntry[]> {
    try {
      const raw = await readFile(getHistoryPath(this.rootDir));
      return raw
        .toString('utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as HistoryLogEntry);
    } catch {
      // No history file yet — return empty list gracefully.
      return [];
    }
  }
}
