/**
 * errors.ts — custom error type for migit-specific failures.
 * What: A named Error subclass so callers can distinguish migit errors from
 *       generic JavaScript errors (e.g. in try/catch or error reporting).
 * How: Extends the built-in Error class and sets `name` to 'MiGitError'.
 */

/**
 * MiGitError — thrown when a migit operation cannot proceed.
 * What: Represents user-facing errors like "not a repository" or bad checkout target.
 * How: Constructor accepts a message string and passes it to Error via super().
 * The `name` property helps logging tools identify the error source.
 */
export class MiGitError extends Error {
  constructor(message: string) {
    // Call the parent Error constructor with the human-readable message.
    super(message);
    // Set a stable error name for stack traces and instanceof checks.
    this.name = 'MiGitError';
  }
}
