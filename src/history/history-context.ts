/**
 * history-context.ts — optional metadata attached to the next history log entry.
 */

import type { HistoryAppendEntry } from './history-logger.js';

type HistoryExtras = Partial<Pick<HistoryAppendEntry, 'policyOverride' | 'branch'>>;

let pendingSuccessExtras: HistoryExtras | undefined;

export function setHistorySuccessExtras(extras: HistoryExtras): void {
  pendingSuccessExtras = extras;
}

export function consumeHistorySuccessExtras(): HistoryExtras | undefined {
  const extras = pendingSuccessExtras;
  pendingSuccessExtras = undefined;
  return extras;
}
