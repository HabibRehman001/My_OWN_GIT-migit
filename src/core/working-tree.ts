/**
 * working-tree.ts — restore tracked files from a commit tree snapshot.
 */

import { join } from 'node:path';
import type { Repository } from './repository.js';
import type { StagedEntry } from '../types/index.js';
import { writeFile, unlink } from '../utils/file-system.js';

export function treeToIndex(tree: Map<string, string>): StagedEntry[] {
  return [...tree.entries()]
    .map(([path, hash]) => ({ path, hash, mode: '100644' }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Count paths whose blob hash differs between two trees (add/modify/delete). */
export function countTreeChanges(
  fromTree: Map<string, string>,
  toTree: Map<string, string>,
): number {
  const paths = new Set([...fromTree.keys(), ...toTree.keys()]);
  let count = 0;

  for (const path of paths) {
    if (fromTree.get(path) !== toTree.get(path)) {
      count++;
    }
  }

  return count;
}

export async function restoreTree(
  repo: Repository,
  tree: Map<string, string>,
): Promise<void> {
  const currentIndex = await repo.indexStore.load();
  const targetPaths = new Set(tree.keys());

  for (const entry of currentIndex) {
    if (targetPaths.has(entry.path)) {
      continue;
    }
    const full = join(repo.rootDir, entry.path);
    try {
      await unlink(full);
    } catch {
      // already removed
    }
  }

  for (const [relPath, hash] of tree) {
    const content = await repo.objectStore.readBlob(hash);
    await writeFile(join(repo.rootDir, relPath), content);
  }
}
