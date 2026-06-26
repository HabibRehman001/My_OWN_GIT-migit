/**
 * walk-options.ts — shared filesystem walk policy for scanners.
 */

export const MAX_STAGE_FILE_BYTES = 10 * 1024 * 1024;

export function isPermissionDenied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

export function formatWalkWarning(relativePath: string, reason: string): string {
  return `warning: skipping ${relativePath} (${reason})`;
}
