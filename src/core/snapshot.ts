/**
 * snapshot.ts — tree snapshots for commits and HEAD comparison.
 */

import type { ObjectStore } from './object-store.js';
import type { StagedEntry } from '../types/index.js';

/** Parse a tree object (JSON path → blob hash map) from the object store. */
export async function parseTreeSnapshot(
  objectStore: ObjectStore,
  treeHash: string,
): Promise<Map<string, string>> {
  return objectStore.readTree(treeHash);
}

/** Load the file snapshot at HEAD (empty map when no commits yet). */
export async function loadHeadSnapshot(
  objectStore: ObjectStore,
  headCommitHash: string | null,
): Promise<Map<string, string>> {
  if (!headCommitHash) return new Map();
  const commit = await objectStore.readCommit(headCommitHash);
  return parseTreeSnapshot(objectStore, commit.tree);
}

export async function createSnapshot(
  objectStore: ObjectStore,
  index: StagedEntry[],
): Promise<string> {
  const tree: Record<string, string> = {};
  for (const entry of index) {
    tree[entry.path] = entry.hash;
  }
  return objectStore.writeTree(tree);
}
