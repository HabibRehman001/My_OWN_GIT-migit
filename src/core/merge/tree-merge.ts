/**
 * tree-merge.ts — hash-first three-way tree merge (BASE / OURS / THEIRS).
 * Compares committed tree maps first; loads blob bodies only for dual-change candidates.
 */

import type { ObjectStore } from '../object-store.js';
import { mergeContentCandidate } from './content-merge.js';
import type {
  MergeConflict,
  MergeConflictType,
  MergePathResult,
  MergePathStatus,
  TreeMergeResult,
} from './merge-types.js';

export interface MergeTreesLoaded {
  baseTree: Map<string, string>;
  ourTree: Map<string, string>;
  theirTree: Map<string, string>;
}

type SideHash = string | undefined;

/** Load the flat path → blob-hash map stored on a commit (not the working tree). */
export async function loadTree(
  objectStore: ObjectStore,
  commitHash: string,
): Promise<Map<string, string>> {
  const commit = await objectStore.readCommit(commitHash);
  return objectStore.readTree(commit.tree);
}

/** Load BASE / OURS / THEIRS trees from commit hashes. */
export async function loadMergeTrees(
  objectStore: ObjectStore,
  baseCommit: string,
  ourCommit: string,
  theirCommit: string,
): Promise<MergeTreesLoaded> {
  const [baseTree, ourTree, theirTree] = await Promise.all([
    loadTree(objectStore, baseCommit),
    loadTree(objectStore, ourCommit),
    loadTree(objectStore, theirCommit),
  ]);

  return { baseTree, ourTree, theirTree };
}

function hashAt(tree: Map<string, string>, path: string): SideHash {
  return tree.get(path);
}

function sideChanged(base: SideHash, side: SideHash): boolean {
  return side !== base;
}

/** Union of every path appearing in any committed tree. */
export function collectAllPaths(
  baseTree: Map<string, string>,
  ourTree: Map<string, string>,
  theirTree: Map<string, string>,
): string[] {
  return [
    ...new Set([
      ...baseTree.keys(),
      ...ourTree.keys(),
      ...theirTree.keys(),
    ]),
  ].sort();
}

function isContentMergeCandidate(
  baseHash: SideHash,
  ourHash: SideHash,
  theirHash: SideHash,
): boolean {
  return (
    ourHash !== undefined &&
    theirHash !== undefined &&
    ourHash !== theirHash &&
    sideChanged(baseHash, ourHash) &&
    sideChanged(baseHash, theirHash)
  );
}

/** True when a path looks like a file on one side and a directory prefix on the other. */
function detectFileDirectoryConflict(
  path: string,
  ourTree: Map<string, string>,
  theirTree: Map<string, string>,
): boolean {
  const ourIsFile = ourTree.has(path);
  const theirIsFile = theirTree.has(path);

  for (const other of ourTree.keys()) {
    if (other !== path && other.startsWith(`${path}/`) && !theirIsFile) {
      return true;
    }
  }

  for (const other of theirTree.keys()) {
    if (other !== path && other.startsWith(`${path}/`) && !ourIsFile) {
      return true;
    }
  }

  if (ourIsFile) {
    for (const other of theirTree.keys()) {
      if (other.startsWith(`${path}/`)) {
        return true;
      }
    }
  }

  if (theirIsFile) {
    for (const other of ourTree.keys()) {
      if (other.startsWith(`${path}/`)) {
        return true;
      }
    }
  }

  return false;
}

function buildConflict(
  path: string,
  conflictType: MergeConflictType,
  baseHash: SideHash,
  ourHash: SideHash,
  theirHash: SideHash,
): MergeConflict {
  return {
    path,
    conflictType,
    ...(baseHash !== undefined ? { baseHash } : {}),
    ...(ourHash !== undefined ? { ourHash } : {}),
    ...(theirHash !== undefined ? { theirHash } : {}),
  };
}

function buildPathResult(
  path: string,
  status: MergePathStatus,
  baseHash: SideHash,
  ourHash: SideHash,
  theirHash: SideHash,
  resultHash?: string,
  conflictType?: MergeConflictType,
): MergePathResult {
  return {
    path,
    status,
    ...(baseHash !== undefined ? { baseHash } : {}),
    ...(ourHash !== undefined ? { ourHash } : {}),
    ...(theirHash !== undefined ? { theirHash } : {}),
    ...(resultHash !== undefined ? { resultHash } : {}),
    ...(conflictType !== undefined ? { conflictType } : {}),
  };
}

export interface MergeTreesOptions {
  currentBranch?: string;
  incomingBranch?: string;
}

/**
 * mergeTrees — hash-first classification; loads blob bodies only for dual-change paths.
 */
export async function mergeTrees(
  objectStore: ObjectStore,
  baseTree: Map<string, string>,
  ourTree: Map<string, string>,
  theirTree: Map<string, string>,
  options?: MergeTreesOptions,
): Promise<TreeMergeResult> {
  const mergedFiles = new Map<string, string>();
  const paths: MergePathResult[] = [];
  const conflicts: MergeConflict[] = [];

  for (const path of collectAllPaths(baseTree, ourTree, theirTree)) {
    const baseHash = hashAt(baseTree, path);
    const ourHash = hashAt(ourTree, path);
    const theirHash = hashAt(theirTree, path);

    const ourChanged = sideChanged(baseHash, ourHash);
    const theirChanged = sideChanged(baseHash, theirHash);

    if (detectFileDirectoryConflict(path, ourTree, theirTree)) {
      const conflict = buildConflict(path, 'file-directory', baseHash, ourHash, theirHash);
      conflicts.push(conflict);
      paths.push(
        buildPathResult(path, 'conflict', baseHash, ourHash, theirHash, undefined, 'file-directory'),
      );
      continue;
    }

    if (!ourChanged && !theirChanged) {
      if (ourHash !== undefined) {
        mergedFiles.set(path, ourHash);
      }
      paths.push(
        buildPathResult(path, 'unchanged', baseHash, ourHash, theirHash, ourHash),
      );
      continue;
    }

    if (ourChanged && !theirChanged) {
      if (ourHash !== undefined) {
        mergedFiles.set(path, ourHash);
      }
      paths.push(
        buildPathResult(path, 'ours', baseHash, ourHash, theirHash, ourHash),
      );
      continue;
    }

    if (!ourChanged && theirChanged) {
      if (theirHash !== undefined) {
        mergedFiles.set(path, theirHash);
      }
      paths.push(
        buildPathResult(path, 'theirs', baseHash, ourHash, theirHash, theirHash),
      );
      continue;
    }

    if (ourHash === theirHash) {
      if (ourHash !== undefined) {
        mergedFiles.set(path, ourHash);
      }
      paths.push(
        buildPathResult(path, 'same-change', baseHash, ourHash, theirHash, ourHash),
      );
      continue;
    }

    if (baseHash === undefined && ourHash !== undefined && theirHash !== undefined) {
      const conflict = buildConflict(path, 'add-add', baseHash, ourHash, theirHash);
      conflicts.push(conflict);
      paths.push(
        buildPathResult(path, 'conflict', baseHash, ourHash, theirHash, undefined, 'add-add'),
      );
      continue;
    }

    if (ourHash === undefined || theirHash === undefined) {
      const conflict = buildConflict(path, 'modify-delete', baseHash, ourHash, theirHash);
      conflicts.push(conflict);
      paths.push(
        buildPathResult(
          path,
          'conflict',
          baseHash,
          ourHash,
          theirHash,
          undefined,
          'modify-delete',
        ),
      );
      continue;
    }

    if (isContentMergeCandidate(baseHash, ourHash, theirHash)) {
      const outcome = await mergeContentCandidate(
        objectStore,
        baseHash,
        ourHash,
        theirHash,
        {
          currentBranch: options?.currentBranch,
          incomingBranch: options?.incomingBranch,
        },
      );

      if (outcome.status === 'merged') {
        const resultHash = await objectStore.writeBlob(outcome.content);
        mergedFiles.set(path, resultHash);
        paths.push(
          buildPathResult(path, 'auto-merged', baseHash, ourHash, theirHash, resultHash),
        );
        continue;
      }

      if (outcome.content) {
        const resultHash = await objectStore.writeBlob(outcome.content);
        mergedFiles.set(path, resultHash);
        paths.push(
          buildPathResult(
            path,
            'conflict',
            baseHash,
            ourHash,
            theirHash,
            resultHash,
            outcome.conflictType,
          ),
        );
      } else {
        paths.push(
          buildPathResult(
            path,
            'conflict',
            baseHash,
            ourHash,
            theirHash,
            undefined,
            outcome.conflictType,
          ),
        );
      }

      conflicts.push(
        buildConflict(path, outcome.conflictType, baseHash, ourHash, theirHash),
      );
      continue;
    }

    conflicts.push(buildConflict(path, 'content', baseHash, ourHash, theirHash));
    paths.push(
      buildPathResult(path, 'conflict', baseHash, ourHash, theirHash, undefined, 'content'),
    );
  }

  return { mergedFiles, paths, conflicts };
}

/** Summarize path statuses for merge preview output. */
export function summarizeTreeMerge(result: TreeMergeResult): {
  unchanged: number;
  changedOnlyOurs: number;
  changedOnlyTheirs: number;
  changedBoth: number;
  conflicts: number;
} {
  let unchanged = 0;
  let changedOnlyOurs = 0;
  let changedOnlyTheirs = 0;
  let changedBoth = 0;

  for (const entry of result.paths) {
    switch (entry.status) {
      case 'unchanged':
        unchanged++;
        break;
      case 'ours':
        changedOnlyOurs++;
        break;
      case 'theirs':
        changedOnlyTheirs++;
        break;
      case 'same-change':
      case 'auto-merged':
      case 'conflict':
        changedBoth++;
        break;
    }
  }

  return {
    unchanged,
    changedOnlyOurs,
    changedOnlyTheirs,
    changedBoth,
    conflicts: result.conflicts.length,
  };
}

export function conflictDescription(conflict: MergeConflict): string {
  switch (conflict.conflictType) {
    case 'add-add':
      return 'added by both branches';
    case 'modify-delete':
      return 'modified/deleted conflict';
    case 'binary':
      return 'binary file changed on both branches';
    case 'file-directory':
      return 'file/directory conflict';
    case 'content':
      return 'modified by both branches';
  }
}
