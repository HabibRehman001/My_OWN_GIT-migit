/**
 * history-format.ts — display helpers for history log entries.
 */

import type { HistoryEntry } from './history-logger.js';

/** Legacy entries stored the full command string in `command`. */
interface LegacyHistoryEntry {
  timestamp: string;
  command: string;
}

function isStructuredEntry(entry: HistoryEntry | LegacyHistoryEntry): entry is HistoryEntry {
  return 'args' in entry && Array.isArray((entry as HistoryEntry).args);
}

/**
 * formatHistoryLine — one-line summary for `migit history` output.
 */
export function formatHistoryLine(entry: HistoryEntry | LegacyHistoryEntry): string {
  if (isStructuredEntry(entry)) {
    const invocation = ['migit', ...entry.args].join(' ').trim();
    const status = entry.status === 'failed' ? ' (failed)' : '';
    return `${entry.timestamp}  ${invocation}${status}`;
  }

  return `${entry.timestamp}  ${entry.command}`;
}

/**
 * formatHistoryForExplain — text block sent to Gemini for --explain.
 */
export function formatHistoryForExplain(entry: HistoryEntry | LegacyHistoryEntry): string {
  if (isStructuredEntry(entry)) {
    const invocation = ['migit', ...entry.args].join(' ').trim();
    const detail =
      entry.status === 'failed' && entry.error
        ? `${invocation} [failed: ${entry.error}]`
        : `${invocation} [${entry.status}, ${entry.durationMs}ms]`;
    return `${entry.timestamp}: ${detail}`;
  }

  return `${entry.timestamp}: ${entry.command}`;
}

/**
 * formatBasicExplanation — plain-text summary when `history explain` runs without --ai.
 */
export function formatBasicExplanation(
  entries: Array<HistoryEntry | LegacyHistoryEntry>,
): string {
  const recent = entries.slice(-20);
  const lines = recent.map((entry, index) => {
    const label = formatHistoryForExplain(entry);
    return `${index + 1}. ${label}`;
  });

  const failed = recent.filter(
    (entry) => isStructuredEntry(entry) && entry.status === 'failed',
  ).length;
  const successful = recent.length - failed;

  return [
    `Recent migit activity (last ${recent.length} command${recent.length === 1 ? '' : 's'}):`,
    '',
    ...lines,
    '',
    `Summary: ${successful} successful, ${failed} failed.`,
    'Tip: run `migit history explain --ai` for an AI-generated summary.',
  ].join('\n');
}
