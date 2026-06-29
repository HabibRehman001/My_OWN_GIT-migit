/**
 * paths.ts — centralizes all filesystem paths used by migit.
 * What: Helper functions that build absolute paths inside a repo.
 * How: Uses Node's `join()` to combine the project root with `.migit/...` segments.
 * Every module that touches disk should use these helpers so paths stay consistent.
 */

import { join, resolve, dirname } from 'node:path';
import { existsSync } from './file-system.js';
import { MiGitError } from './errors.js';

/**
 * findRepositoryRoot — walks up from startDir until a `.migit` folder is found.
 * What: Discovers the repository root so commands work from any subfolder.
 * How:
 *   1. Start at startDir (defaults to process.cwd()).
 *   2. If `<current>/.migit` exists → return current (that folder IS the repo root).
 *   3. Else move to parent directory and repeat.
 *   4. If parent === current (filesystem root reached) → throw MiGitError.
 *
 * Example:
 *   cwd = /home/user/project/src/controllers
 *   walks: .../src/controllers → .../src → .../project  ← .migit found → returns .../project
 */
export function findRepositoryRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);

  while (true) {
    if (existsSync(join(current, '.migit'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new MiGitError(
        'Not a migit repository (or any parent directory). Run "migit init" to create one.',
      );
    }
    current = parent;
  }
}

/**
 * getMiGitDir — returns the hidden `.migit` metadata directory for a repo.
 * What: Root of all migit internal data (objects, refs, index).
 * How: Joins `rootDir` (defaults to cwd) with `.migit`.
 */
export function getMiGitDir(rootDir: string = process.cwd()): string {
  return join(rootDir, '.migit');
}

/**
 * getObjectsDir — returns `.migit/objects` where content-addressed blobs/commits live.
 * What: The object database directory (similar to Git's `.git/objects`).
 * How: Nests `objects` inside the migit dir returned by getMiGitDir.
 */
export function getObjectsDir(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'objects');
}

/**
 * getIndexPath — returns the path to the staging index file.
 * What: A JSON file listing all currently staged files and their hashes.
 * How: Stored as `.migit/index` (flat file, not a directory).
 */
export function getIndexPath(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'index');
}

export function getHeadFilePath(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'HEAD');
}

/**
 * getBranchRefPath — path to a named branch ref file.
 */
export function getBranchRefPath(rootDir: string, branch: string): string {
  return join(getRefsDir(rootDir), 'heads', branch);
}

/**
 * getHeadPath — @deprecated use getBranchRefPath with current branch name.
 */
export function getHeadPath(rootDir: string = process.cwd()): string {
  return join(getRefsDir(rootDir), 'heads', 'main');
}

/**
 * getRefsDir — returns `.migit/refs` where branch pointers are stored.
 * What: Directory containing `heads/` subfolder with one file per branch.
 * How: Each branch file contains a single commit hash string.
 */
export function getRefsDir(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'refs');
}

/**
 * getHistoryPath — returns the command history log file path.
 * What: Append-only log of every migit command the user ran.
 * How: Stored as `.migit/history.log`, one JSON object per line (JSONL format).
 */
export function getHistoryPath(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'history.log');
}

/**
 * getConfigPath — returns `.migit/config.json` (author and AI settings).
 */
export function getConfigPath(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'config.json');
}

/**
 * getCommitGenerationsCachePath — optional derived cache (safe to delete).
 * What: Maps commit hashes to computed generation numbers for legacy commits.
 * How: `.migit/cache/commit-generations.json`; rebuilt on demand when missing.
 */
export function getCommitGenerationsCachePath(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'cache', 'commit-generations.json');
}

/** Path to in-progress merge metadata (`.migit/merge-state.json`). */
export function getMergeStatePath(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'merge-state.json');
}

/** Default merge commit message draft (`.migit/MERGE_MSG`). */
export function getMergeMsgPath(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'MERGE_MSG');
}

/** Directory for repository-wide lock files (`.migit/locks/`). */
export function getLocksDir(rootDir: string = process.cwd()): string {
  return join(getMiGitDir(rootDir), 'locks');
}

/** Exclusive repository lock held during merge operations (`.migit/locks/repository.lock`). */
export function getRepositoryLockPath(rootDir: string = process.cwd()): string {
  return join(getLocksDir(rootDir), 'repository.lock');
}
