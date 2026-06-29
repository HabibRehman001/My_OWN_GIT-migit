/**
 * merge-base.ts — best common ancestor of two commits (BASE for three-way merge).
 */

import type { ObjectStore } from '../object-store.js';
import type { AncestryOptions } from './ancestry.js';
import { GenerationResolver } from './generation.js';
import { MiGitError } from '../../utils/errors.js';

async function frontierMaxGeneration(
  resolver: GenerationResolver,
  frontier: string[],
): Promise<number> {
  if (frontier.length === 0) {
    return -1;
  }

  let max = -1;
  for (const hash of frontier) {
    const generation = await resolver.getGeneration(hash);
    if (generation > max) {
      max = generation;
    }
  }
  return max;
}

async function expandFrontier(
  objectStore: ObjectStore,
  resolver: GenerationResolver,
  frontier: string[],
  ownReachable: Set<string>,
  otherReachable: Set<string>,
): Promise<{ nextFrontier: string[]; found: string | null }> {
  let bestHash = frontier[0]!;
  let bestGen = await resolver.getGeneration(bestHash);

  for (const hash of frontier.slice(1)) {
    const generation = await resolver.getGeneration(hash);
    if (generation > bestGen) {
      bestGen = generation;
      bestHash = hash;
    }
  }

  const nextFrontier = frontier.filter((hash) => hash !== bestHash);
  let found: string | null = null;

  if (!ownReachable.has(bestHash)) {
    ownReachable.add(bestHash);
    if (otherReachable.has(bestHash)) {
      found = bestHash;
    }

    const commit = await objectStore.readCommit(bestHash);
    for (const parent of commit.parents) {
      if (!ownReachable.has(parent) && !nextFrontier.includes(parent)) {
        nextFrontier.push(parent);
      }
    }
  }

  return { nextFrontier, found };
}

/**
 * findMergeBase — most recent common ancestor of ourCommit and theirCommit.
 * Walks backwards from the higher-generation side first; uses optional generation cache.
 */
export async function findMergeBase(
  objectStore: ObjectStore,
  ourCommit: string,
  theirCommit: string,
  options?: AncestryOptions,
): Promise<string> {
  if (ourCommit === theirCommit) {
    return ourCommit;
  }

  const resolver = new GenerationResolver(objectStore, options?.rootDir);
  await resolver.init();

  try {
    const ourReachable = new Set<string>();
    const theirReachable = new Set<string>();
    let ourFrontier = [ourCommit];
    let theirFrontier = [theirCommit];
    let bestCommon: string | null = null;
    let bestGeneration = -1;

    while (ourFrontier.length > 0 || theirFrontier.length > 0) {
      const ourMax = await frontierMaxGeneration(resolver, ourFrontier);
      const theirMax = await frontierMaxGeneration(resolver, theirFrontier);

      if (bestCommon !== null && ourMax < bestGeneration && theirMax < bestGeneration) {
        break;
      }

      const walkOur =
        ourFrontier.length > 0 && (theirFrontier.length === 0 || ourMax >= theirMax);

      if (walkOur) {
        const expanded = await expandFrontier(
          objectStore,
          resolver,
          ourFrontier,
          ourReachable,
          theirReachable,
        );
        ourFrontier = expanded.nextFrontier;
        if (expanded.found !== null) {
          const generation = await resolver.getGeneration(expanded.found);
          if (generation > bestGeneration) {
            bestGeneration = generation;
            bestCommon = expanded.found;
          }
        }
      } else {
        const expanded = await expandFrontier(
          objectStore,
          resolver,
          theirFrontier,
          theirReachable,
          ourReachable,
        );
        theirFrontier = expanded.nextFrontier;
        if (expanded.found !== null) {
          const generation = await resolver.getGeneration(expanded.found);
          if (generation > bestGeneration) {
            bestGeneration = generation;
            bestCommon = expanded.found;
          }
        }
      }
    }

    if (bestCommon === null) {
      throw new MiGitError(
        `No common ancestor between ${ourCommit.slice(0, 7)} and ${theirCommit.slice(0, 7)}`,
      );
    }

    return bestCommon;
  } finally {
    await resolver.flush();
  }
}
