/**
 * merge-resolve.ts — explicit conflict resolution during an in-progress merge.
 */

import { join } from 'node:path';
import type { Repository } from '../repository.js';
import { hasConflictMarkers } from './conflict-markers.js';
import { requireMergeState, saveMergeState } from './merge-state.js';
import { resolvePathInRepository, toRepositoryRelativePath } from '../../utils/path-guard.js';
import { readFile } from '../../utils/file-system.js';
import { MiGitError } from '../../utils/errors.js';

export interface ResolveConflictResult {
  path: string;
  hash: string;
  remainingConflicts: number;
}

function toRepoPath(rootDir: string, inputPath: string): string {
  const absolute = resolvePathInRepository(rootDir, inputPath);
  return toRepositoryRelativePath(rootDir, absolute);
}

/**
 * resolveMergeConflict — stage a manually edited file and mark its conflict resolved.
 * Does not run on `migit add`; callers must invoke this command explicitly.
 */
export async function resolveMergeConflict(
  repo: Repository,
  inputPath: string,
): Promise<ResolveConflictResult> {
  const relPath = toRepoPath(repo.rootDir, inputPath);
  const state = await requireMergeState(repo.rootDir, 'Resolve');

  const conflict = state.conflicts.find((entry) => entry.path === relPath);
  if (!conflict) {
    throw new MiGitError(`Resolve stopped: "${relPath}" is not a listed merge conflict.`);
  }

  if (conflict.resolved) {
    throw new MiGitError(`Resolve stopped: "${relPath}" is already resolved.`);
  }

  const fullPath = join(repo.rootDir, relPath);
  let content: Buffer;
  try {
    content = await readFile(fullPath);
  } catch {
    throw new MiGitError(`Resolve stopped: "${relPath}" does not exist in the working tree.`);
  }

  const text = content.toString('utf8');
  if (hasConflictMarkers(text)) {
    throw new MiGitError(
      `Resolve stopped: "${relPath}" still contains conflict markers. Edit the file and remove all markers before running resolve.`,
    );
  }

  const hash = await repo.objectStore.writeBlob(content);
  await repo.indexStore.merge([{ path: relPath, hash, mode: '100644' }]);

  conflict.resolved = true;
  await saveMergeState(repo.rootDir, state);

  const remainingConflicts = state.conflicts.filter((entry) => !entry.resolved).length;

  return {
    path: relPath,
    hash,
    remainingConflicts,
  };
}

export class MergeResolveEngine {
  constructor(private readonly repo: Repository) {}

  async resolve(paths: string[]): Promise<ResolveConflictResult[]> {
    const results: ResolveConflictResult[] = [];
    for (const path of paths) {
      results.push(await resolveMergeConflict(this.repo, path));
    }
    return results;
  }
}
