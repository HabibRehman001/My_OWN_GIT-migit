/**
 * scanner.ts — walks the filesystem and builds staged entries for the index.
 */

import { readFile } from '../utils/file-system.js';
import { IgnoreRules } from '../utils/ignore-rules.js';
import { resolvePathInRepository, toRepositoryRelativePath } from '../utils/path-guard.js';
import {
  formatWalkWarning,
  isPermissionDenied,
  MAX_STAGE_FILE_BYTES,
} from '../utils/walk-options.js';
import type { ObjectStore } from './object-store.js';
import type { StagedEntry } from '../types/index.js';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MiGitError } from '../utils/errors.js';

export class Scanner {
  constructor(
    private readonly rootDir: string,
    private readonly objectStore: ObjectStore,
  ) {}

  async stage(paths: string[]): Promise<StagedEntry[]> {
    const entries: StagedEntry[] = [];
    const ignoreRules = await IgnoreRules.load(this.rootDir);

    for (const target of paths) {
      const fullPath = resolvePathInRepository(this.rootDir, target);
      await this.scanPath(fullPath, entries, ignoreRules);
    }

    return entries;
  }

  private async scanPath(
    fullPath: string,
    entries: StagedEntry[],
    ignoreRules: IgnoreRules,
  ): Promise<void> {
    let rel: string;
    try {
      rel = toRepositoryRelativePath(this.rootDir, fullPath);
    } catch (error) {
      throw error instanceof MiGitError ? error : new MiGitError(String(error));
    }

    if (rel === '.' || rel === '') {
      await this.scanDirectory(fullPath, entries, ignoreRules);
      return;
    }

    let info;
    try {
      info = await lstat(fullPath);
    } catch (error) {
      if (isPermissionDenied(error)) {
        console.warn(formatWalkWarning(rel, 'permission denied'));
        return;
      }
      throw error;
    }

    if (info.isSymbolicLink()) {
      console.warn(formatWalkWarning(rel, 'symbolic links are not followed'));
      return;
    }

    if (ignoreRules.isIgnored(rel, info.isDirectory())) {
      return;
    }

    if (info.isDirectory()) {
      await this.scanDirectory(fullPath, entries, ignoreRules);
      return;
    }

    if (info.size > MAX_STAGE_FILE_BYTES) {
      console.warn(formatWalkWarning(rel, `file exceeds ${MAX_STAGE_FILE_BYTES} bytes`));
      return;
    }

    try {
      const content = await readFile(fullPath);
      const hash = await this.objectStore.writeBlob(content);
      entries.push({
        path: rel,
        hash,
        mode: '100644',
      });
    } catch (error) {
      if (isPermissionDenied(error)) {
        console.warn(formatWalkWarning(rel, 'permission denied'));
        return;
      }
      throw error;
    }
  }

  private async scanDirectory(
    fullPath: string,
    entries: StagedEntry[],
    ignoreRules: IgnoreRules,
  ): Promise<void> {
    let children: string[];
    try {
      children = await readdir(fullPath);
    } catch (error) {
      const rel = toRepositoryRelativePath(this.rootDir, fullPath);
      if (isPermissionDenied(error)) {
        console.warn(formatWalkWarning(rel === '.' ? '.' : rel, 'permission denied'));
        return;
      }
      throw error;
    }

    for (const child of children) {
      await this.scanPath(join(fullPath, child), entries, ignoreRules);
    }
  }
}
