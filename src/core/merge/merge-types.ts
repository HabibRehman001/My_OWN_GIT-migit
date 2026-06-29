/**
 * merge-types.ts — shared types for tree merge, preview, and merge engine.
 */

export type MergePathStatus =
  | 'unchanged'
  | 'ours'
  | 'theirs'
  | 'same-change'
  | 'auto-merged'
  | 'conflict';

export type MergeConflictType =
  | 'content'
  | 'add-add'
  | 'modify-delete'
  | 'binary'
  | 'file-directory';

export interface MergePathResult {
  path: string;
  status: MergePathStatus;
  baseHash?: string;
  ourHash?: string;
  theirHash?: string;
  resultHash?: string;
  conflictType?: MergeConflictType;
}

export interface MergeConflict {
  path: string;
  conflictType: MergeConflictType;
  baseHash?: string;
  ourHash?: string;
  theirHash?: string;
}

export interface TreeMergeResult {
  mergedFiles: Map<string, string>;
  paths: MergePathResult[];
  conflicts: MergeConflict[];
}

/** A line-range conflict discovered during text-file three-way merge. */
export interface LineConflict {
  /** 1-based line number in base where the conflict starts */
  startLine: number;
  /** 1-based line number in base where the conflict ends (exclusive) */
  endLine: number;
  baseLines: string[];
  ourLines: string[];
  theirLines: string[];
}

export interface FileMergeResult {
  clean: boolean;
  content: Buffer;
  conflicts: LineConflict[];
}

export interface TextFileMergeInput {
  base: string;
  ours: string;
  theirs: string;
  /** Current branch name for conflict markers (default: `main`). */
  currentBranch?: string;
  /** Incoming branch name for conflict markers (default: `branch`). */
  incomingBranch?: string;
}
