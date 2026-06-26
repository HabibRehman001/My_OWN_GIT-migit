/**
 * add-scope.ts — determines whether an indexed path falls within an `migit add` scope.
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '') || '.';
}

/**
 * Returns true if indexedPath should be affected by `migit add <addPaths>`.
 * - `migit add .`  → entire repository
 * - `migit add src/` → paths under src/
 * - `migit add file.ts` → that file only
 */
export async function isPathInAddScope(
  indexedPath: string,
  addPaths: string[],
  rootDir: string,
): Promise<boolean> {
  const normalized = normalizePath(indexedPath);

  for (const target of addPaths) {
    const scope = normalizePath(target);

    if (scope === '.') {
      return true;
    }

    const fullPath = join(rootDir, target);
    let isDirectory = false;
    try {
      isDirectory = (await stat(fullPath)).isDirectory();
    } catch {
      isDirectory = false;
    }

    if (isDirectory) {
      if (normalized === scope || normalized.startsWith(`${scope}/`)) {
        return true;
      }
    } else if (normalized === scope) {
      return true;
    }
  }

  return false;
}

/**
 * From the current index, return paths within add scope that no longer exist on disk.
 */
export async function findScopedDeletions(
  indexedPaths: Iterable<string>,
  workingPaths: Set<string>,
  addPaths: string[],
  rootDir: string,
): Promise<string[]> {
  const deletions: string[] = [];

  for (const indexedPath of indexedPaths) {
    if (workingPaths.has(indexedPath)) continue;
    if (await isPathInAddScope(indexedPath, addPaths, rootDir)) {
      deletions.push(indexedPath);
    }
  }

  return deletions;
}
