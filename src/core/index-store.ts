/**
 * index-store.ts — persistence for the repository index (complete next snapshot).
 * The index lists every tracked file path → object ID. It merges on add and
 * stays equal to HEAD after commit (not cleared).
 */

import { readFile } from '../utils/file-system.js';
import { getIndexPath } from '../utils/paths.js';
import type { StagedEntry } from '../types/index.js';
import { atomicWrite } from '../utils/atomic-write.js';

/**
 * IndexStore — manages the staging index file for one repository.
 * What: Bridge between in-memory staged entries and the on-disk index file.
 */
export class IndexStore {
  constructor(private readonly rootDir: string) {}

  /**
   * load — reads staged entries from disk, or returns [] if index missing.
   * What: Restores the staging area state when add/commit/status runs.
   * How: Read JSON file → parse → cast to StagedEntry array; catch → empty array.
   */
  async load(): Promise<StagedEntry[]> {
    const path = getIndexPath(this.rootDir);
    try {
      const raw = await readFile(path);
      return JSON.parse(raw.toString('utf-8')) as StagedEntry[];
    } catch {
      // Index file doesn't exist yet (fresh repo) — treat as empty staging area.
      return [];
    }
  }

  /**
   * merge — load existing index, overlay updates, optionally remove paths, save.
   */
  async merge(updates: StagedEntry[], removePaths: string[] = []): Promise<StagedEntry[]> {
    const map = new Map((await this.load()).map((e) => [e.path, e]));
    for (const path of removePaths) {
      map.delete(path);
    }
    for (const entry of updates) {
      map.set(entry.path, entry);
    }
    const merged = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
    await this.save(merged);
    return merged;
  }

  /**
   * save — writes the full index to disk (complete snapshot, not a delta).
   */
  async save(entries: StagedEntry[]): Promise<void> {
    const path = getIndexPath(this.rootDir);
    await atomicWrite(path, JSON.stringify(entries, null, 2));
  }
}
