/**
 * commit-generation-cache.ts — optional on-disk cache for computed commit generations.
 * Safe to delete; ancestry code recomputes and may repopulate when rootDir is provided.
 */

import { getCommitGenerationsCachePath } from '../../utils/paths.js';
import { atomicWrite } from '../../utils/atomic-write.js';
import { existsSync, readFile } from '../../utils/file-system.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class CommitGenerationCache {
  private readonly entries = new Map<string, number>();
  private loaded = false;

  constructor(private readonly rootDir: string) {}

  /** Load from disk when present; missing file is normal. */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.loaded = true;
    const path = getCommitGenerationsCachePath(this.rootDir);
    if (!existsSync(path)) {
      return;
    }

    try {
      const raw = JSON.parse((await readFile(path)).toString('utf8')) as unknown;
      if (typeof raw !== 'object' || raw === null) {
        return;
      }

      for (const [hash, generation] of Object.entries(raw)) {
        if (!HASH_PATTERN.test(hash) || typeof generation !== 'number' || generation < 1) {
          continue;
        }
        this.entries.set(hash, generation);
      }
    } catch {
      // Corrupt or unreadable cache — treat as empty; will be rebuilt.
    }
  }

  get(hash: string): number | undefined {
    return this.entries.get(hash);
  }

  set(hash: string, generation: number): void {
    if (generation < 1) {
      return;
    }
    this.entries.set(hash, generation);
  }

  /** Persist only when entries changed; failures are ignored (cache remains optional). */
  async flush(): Promise<void> {
    if (this.entries.size === 0) {
      return;
    }

    const payload: Record<string, number> = {};
    for (const [hash, generation] of this.entries) {
      payload[hash] = generation;
    }

    try {
      await atomicWrite(
        getCommitGenerationsCachePath(this.rootDir),
        `${JSON.stringify(payload, null, 2)}\n`,
      );
    } catch {
      // Cache is a performance hint only.
    }
  }
}
