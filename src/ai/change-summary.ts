/**
 * change-summary.ts — structured staged-change metadata for smart commits.
 */

export type ChangeType = 'added' | 'modified' | 'deleted';

export interface FileChangeSummary {
  path: string;
  changeType: ChangeType;
  addedLines: number;
  deletedLines: number;
  summary: string[];
  /** Redacted +/- lines sent to Gemini (metadata mode only). */
  diffSample?: string[];
}

export interface ChangeSummary {
  files: FileChangeSummary[];
  added: FileChangeSummary[];
  modified: FileChangeSummary[];
  deleted: FileChangeSummary[];
  totalFiles: number;
}

export function buildChangeSummary(files: FileChangeSummary[]): ChangeSummary {
  const added = files.filter((f) => f.changeType === 'added');
  const modified = files.filter((f) => f.changeType === 'modified');
  const deleted = files.filter((f) => f.changeType === 'deleted');

  return {
    files,
    added,
    modified,
    deleted,
    totalFiles: files.length,
  };
}

/**
 * Payload sent to Gemini in metadata mode (no full source files).
 */
export function toSmartCommitPayload(changes: ChangeSummary): object {
  return {
    files: changes.files.map((file) => ({
      path: file.path,
      changeType: file.changeType,
      addedLines: file.addedLines,
      deletedLines: file.deletedLines,
      summary: file.summary,
      ...(file.diffSample?.length ? { diffSample: file.diffSample } : {}),
    })),
  };
}
