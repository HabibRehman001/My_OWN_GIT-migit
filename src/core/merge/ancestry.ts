/**
 * ancestry.ts — walk commit parent graphs for merge-base and ancestry checks.
 */

import type { ObjectStore } from '../object-store.js';
import { GenerationResolver } from './generation.js';

export type AncestryOptions = {
  /**
   * Repository root — enables optional `.migit/cache/commit-generations.json`.
   * The cache is a performance hint only; safe to delete at any time.
   */
  rootDir?: string;
};

async function createResolver(
  objectStore: ObjectStore,
  options?: AncestryOptions,
): Promise<GenerationResolver> {
  const resolver = new GenerationResolver(objectStore, options?.rootDir);
  await resolver.init();
  return resolver;
}

/** All commits reachable from startHash (inclusive), using BFS with cycle guard. */
export async function collectAncestors(
  objectStore: ObjectStore,
  startHash: string,
): Promise<Set<string>> {
  const ancestors = new Set<string>();
  const queue = [startHash];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (ancestors.has(current)) {
      continue;
    }

    ancestors.add(current);

    const commit = await objectStore.readCommit(current);
    for (const parent of commit.parents) {
      queue.push(parent);
    }
  }

  return ancestors;
}

/**
 * isAncestor — true when possibleAncestor appears on the parent walk from commitHash.
 * Uses generation pruning and a visited set (cycle-safe on malformed graphs).
 */
export async function isAncestor(
  objectStore: ObjectStore,
  possibleAncestor: string,
  commitHash: string,
  options?: AncestryOptions,
): Promise<boolean> {
  if (possibleAncestor === commitHash) {
    return true;
  }

  const resolver = await createResolver(objectStore, options);

  try {
    const [ancestorGen, descendantGen] = await Promise.all([
      resolver.getGeneration(possibleAncestor),
      resolver.getGeneration(commitHash),
    ]);

    if (ancestorGen > descendantGen) {
      return false;
    }

    const queue = [commitHash];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === possibleAncestor) {
        return true;
      }

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      const currentGen = await resolver.getGeneration(current);
      if (currentGen < ancestorGen) {
        continue;
      }

      const commit = await objectStore.readCommit(current);
      queue.push(...commit.parents);
    }

    return false;
  } finally {
    await resolver.flush();
  }
}
