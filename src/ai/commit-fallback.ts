/**
 * commit-fallback.ts — deterministic commit messages when Gemini is unavailable.
 */

import type { ChangeSummary } from './change-summary.js';
import { truncateCommitMessage } from './commit-message.js';

export function fallbackMessage(changes: ChangeSummary): string {
  if (changes.added.length === 1 && changes.deleted.length === 0 && changes.modified.length === 0) {
    return truncateCommitMessage(`Add ${changes.added[0].path}`);
  }

  if (changes.deleted.length > 0) {
    return truncateCommitMessage('Update project files and remove unused files');
  }

  if (changes.modified.length === 1 && changes.added.length === 0 && changes.deleted.length === 0) {
    const file = changes.modified[0];
    if (file.summary[0]) {
      return truncateCommitMessage(file.summary[0]);
    }
    return truncateCommitMessage(`Update ${file.path}`);
  }

  return truncateCommitMessage(`Update ${changes.totalFiles} project files`);
}
