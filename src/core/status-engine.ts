/**
 * status-engine.ts — three-way status: HEAD ↔ Index ↔ Working directory.
 */

import type { Repository } from './repository.js';
import type { StatusEntry } from '../types/index.js';
import { loadHeadSnapshot } from './snapshot.js';
import { readFile } from '../utils/file-system.js';
import { IgnoreRules } from '../utils/ignore-rules.js';
import {
  formatWalkWarning,
  isPermissionDenied,
  MAX_STAGE_FILE_BYTES,
} from '../utils/walk-options.js';
import { toRepositoryRelativePath } from '../utils/path-guard.js';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export class StatusEngine {
  constructor(private readonly repo: Repository) {}

  async getStatus(): Promise<StatusEntry[]> {
    this.repo.assertInitialized();

    const headFiles = await loadHeadSnapshot(
      this.repo.objectStore,
      await this.repo.refs.getHead(),
    );
    const indexFiles = new Map(
      (await this.repo.indexStore.load()).map((e) => [e.path, e.hash]),
    );
    const workingFiles = await this.scanWorkingDirectory();

    const allPaths = new Set([
      ...headFiles.keys(),
      ...indexFiles.keys(),
      ...workingFiles.keys(),
    ]);

    const entries: StatusEntry[] = [];

    for (const path of allPaths) {
      const headHash = headFiles.get(path);
      const indexHash = indexFiles.get(path);
      const workingHash = workingFiles.get(path);

      const entry = this.categorize(path, headHash, indexHash, workingHash);
      if (entry) entries.push(entry);
    }

    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  private categorize(
    path: string,
    headHash: string | undefined,
    indexHash: string | undefined,
    workingHash: string | undefined,
  ): StatusEntry | null {
    const staged = headHash !== indexHash;
    const unstaged = indexHash !== workingHash;

    if (!staged && !unstaged) return null;

    let stagedStatus: StatusEntry['staged'] = null;
    let workingStatus: StatusEntry['working'] = null;

    if (staged) {
      if (headHash === undefined && indexHash !== undefined) {
        stagedStatus = 'added';
      } else if (headHash !== undefined && indexHash === undefined) {
        stagedStatus = 'deleted';
      } else {
        stagedStatus = 'modified';
      }
    }

    if (unstaged) {
      if (indexHash !== undefined && workingHash === undefined) {
        workingStatus = 'deleted';
      } else if (indexHash === undefined && workingHash !== undefined) {
        workingStatus = 'untracked';
      } else if (indexHash !== undefined && workingHash !== undefined) {
        workingStatus = 'modified';
      }
    }

    return { path, staged: stagedStatus, working: workingStatus };
  }

  private async scanWorkingDirectory(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const ignoreRules = await IgnoreRules.load(this.repo.rootDir);

    await this.walkWorkingTree(this.repo.rootDir, ignoreRules, async (relPath, fullPath) => {
      const content = await readFile(fullPath);
      files.set(relPath, this.repo.objectStore.blobId(content));
    });

    return files;
  }

  private async walkWorkingTree(
    dir: string,
    ignoreRules: IgnoreRules,
    onFile: (relPath: string, fullPath: string) => Promise<void>,
  ): Promise<void> {
    let children: string[];
    try {
      children = await readdir(dir);
    } catch (error) {
      if (isPermissionDenied(error)) {
        const rel = toRepositoryRelativePath(this.repo.rootDir, dir);
        console.warn(formatWalkWarning(rel === '.' ? '.' : rel, 'permission denied'));
        return;
      }
      throw error;
    }

    for (const child of children) {
      const full = join(dir, child);
      let rel: string;
      try {
        rel = toRepositoryRelativePath(this.repo.rootDir, full);
      } catch {
        continue;
      }

      let info;
      try {
        info = await lstat(full);
      } catch (error) {
        if (isPermissionDenied(error)) {
          console.warn(formatWalkWarning(rel, 'permission denied'));
          continue;
        }
        throw error;
      }

      if (info.isSymbolicLink()) {
        continue;
      }

      if (ignoreRules.isIgnored(rel, info.isDirectory())) {
        continue;
      }

      if (info.isDirectory()) {
        await this.walkWorkingTree(full, ignoreRules, onFile);
        continue;
      }

      if (info.size > MAX_STAGE_FILE_BYTES) {
        console.warn(formatWalkWarning(rel, `file exceeds ${MAX_STAGE_FILE_BYTES} bytes`));
        continue;
      }

      try {
        await onFile(rel, full);
      } catch (error) {
        if (isPermissionDenied(error)) {
          console.warn(formatWalkWarning(rel, 'permission denied'));
          continue;
        }
        throw error;
      }
    }
  }
}
