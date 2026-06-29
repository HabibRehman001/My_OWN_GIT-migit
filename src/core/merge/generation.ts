/**
 * generation.ts — resolve commit generation from object, memory, or optional cache.
 */

import type { CommitData } from '../../types/index.js';
import type { ObjectStore } from '../object-store.js';
import { CommitGenerationCache } from './commit-generation-cache.js';

/** Root commits use generation 1; normal/merge commits use max(parent generations) + 1. */
export function generationFromParents(parentGenerations: number[]): number {
  if (parentGenerations.length === 0) {
    return 1;
  }
  return Math.max(...parentGenerations) + 1;
}

/** True when generation must be derived (missing or legacy zero). */
export function needsGenerationResolution(generation: number | undefined): boolean {
  return generation === undefined || generation < 1;
}

/**
 * GenerationResolver — memoizes generations; optionally persists derived values to disk.
 * The on-disk cache is optional and safe to delete.
 */
export class GenerationResolver {
  private readonly memory = new Map<string, number>();
  private readonly computing = new Set<string>();
  private readonly diskCache: CommitGenerationCache | null;
  private dirty = false;

  constructor(
    private readonly objectStore: ObjectStore,
    rootDir?: string,
  ) {
    this.diskCache = rootDir ? new CommitGenerationCache(rootDir) : null;
  }

  async init(): Promise<void> {
    if (this.diskCache) {
      await this.diskCache.load();
    }
  }

  async flush(): Promise<void> {
    if (!this.diskCache || !this.dirty) {
      return;
    }

    for (const [hash, generation] of this.memory) {
      this.diskCache.set(hash, generation);
    }
    await this.diskCache.flush();
    this.dirty = false;
  }

  async getGeneration(hash: string): Promise<number> {
    const cached = this.memory.get(hash);
    if (cached !== undefined) {
      return cached;
    }

    if (this.computing.has(hash)) {
      return 1;
    }

    this.computing.add(hash);
    try {
      const commit = await this.objectStore.readCommit(hash);

      if (!needsGenerationResolution(commit.generation)) {
        this.remember(hash, commit.generation!);
        return commit.generation!;
      }

      const fromDisk = this.diskCache?.get(hash);
      if (fromDisk !== undefined) {
        this.remember(hash, fromDisk);
        return fromDisk;
      }

      const computed = await this.computeFromCommit(hash, commit);
      this.remember(hash, computed, true);
      return computed;
    } finally {
      this.computing.delete(hash);
    }
  }

  private remember(hash: string, generation: number, derived = false): void {
    this.memory.set(hash, generation);
    if (derived) {
      this.dirty = true;
    }
  }

  private async computeFromCommit(hash: string, commit: CommitData): Promise<number> {
    if (commit.parents.length === 0) {
      return 1;
    }

    const parentGenerations = await Promise.all(
      commit.parents.map((parent) => this.getGeneration(parent)),
    );
    return generationFromParents(parentGenerations);
  }
}
