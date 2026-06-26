/**
 * commit-message.ts — validate and normalize smart-commit responses.
 */

export const COMMIT_MESSAGE_MAX_LENGTH = 72;

export function truncateCommitMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= COMMIT_MESSAGE_MAX_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, COMMIT_MESSAGE_MAX_LENGTH).trimEnd();
}

/**
 * normalizeCommitMessage — single line, no quotes, max 72 chars.
 * Returns null when the response is unusable.
 */
export function normalizeCommitMessage(raw: string): string | null {
  let message = raw
    .trim()
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!message) {
    return null;
  }

  message = message.replace(/^["'`]+|["'`]+$/g, '').trim();

  if (!message || /\n/.test(message)) {
    return null;
  }

  return truncateCommitMessage(message);
}
