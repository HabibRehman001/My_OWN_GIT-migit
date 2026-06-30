/**
 * refs.ts — manages branch references and HEAD pointer.
 *
 * HEAD (.migit/HEAD)     → which branch is currently checked out
 *                            e.g. "ref: refs/heads/main"
 * refs/heads/<branch>    → commit hash at the tip of that branch
 *
 * commit updates refs/heads/<current-branch> via setHead().
 * checkout updates only HEAD via setCurrentBranch() — never overwrites
 * another branch's commit hash.
 */

import { readdir as fsReaddir, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readFile, unlink, ensureDir } from '../utils/file-system.js';
import { getHeadFilePath, getBranchRefPath, getRefsDir } from '../utils/paths.js';
import { existsSync } from '../utils/file-system.js';
import { atomicWrite } from '../utils/atomic-write.js';
import { validateBranchName } from '../utils/branch-name.js';

const HEAD_REF_PATTERN = /^ref: refs\/heads\/(.+)$/;

export class Refs {
  constructor(private readonly rootDir: string) {}

  /** Commit hash at the tip of the current branch. */
  async getHead(): Promise<string | null> {
    return this.readBranch(await this.getCurrentBranch());
  }

  /** Moves the current branch pointer to a new commit hash. */
  async setHead(hash: string): Promise<void> {
    const branch = await this.getCurrentBranch();
    await this.setBranch(branch, hash);
  }

  /** Reads the commit hash stored for a branch name. */
  async readBranch(name: string): Promise<string | null> {
    try {
      const raw = await readFile(getBranchRefPath(this.rootDir, name));
      return raw.toString('utf-8').trim() || null;
    } catch {
      return null;
    }
  }

  /** Active branch name from `.migit/HEAD`. */
  async getCurrentBranch(): Promise<string> {
    const content = await this.readHeadFile();
    const match = content.match(HEAD_REF_PATTERN);
    if (!match) {
      throw new Error('Invalid .migit/HEAD — expected: ref: refs/heads/<branch>');
    }
    return match[1];
  }

  /**
   * Points HEAD at a branch name. Only updates `.migit/HEAD`.
   * Does NOT modify refs/heads/<branch> commit hashes.
   */
  async setCurrentBranch(name: string): Promise<void> {
    validateBranchName(name);
    await atomicWrite(getHeadFilePath(this.rootDir), `ref: refs/heads/${name}\n`);
  }

  /** Writes the initial HEAD file on `migit init`. */
  async initHead(defaultBranch = 'main'): Promise<void> {
    await this.setCurrentBranch(defaultBranch);
  }

  /** Validates `.migit/HEAD` exists and has the correct format. */
  async verifyHead(): Promise<string[]> {
    const issues: string[] = [];
    const headPath = getHeadFilePath(this.rootDir);

    if (!existsSync(headPath)) {
      issues.push('Missing .migit/HEAD file');
      return issues;
    }

    try {
      const content = await this.readHeadFile();
      if (!HEAD_REF_PATTERN.test(content)) {
        issues.push(
          'Invalid .migit/HEAD format (expected: ref: refs/heads/<branch>)',
        );
      }
    } catch {
      issues.push('Unreadable .migit/HEAD file');
    }

    return issues;
  }

  private async readHeadFile(): Promise<string> {
    const raw = await readFile(getHeadFilePath(this.rootDir));
    return raw.toString('utf-8').trim();
  }

  async setBranch(name: string, hash: string | null): Promise<void> {
    validateBranchName(name);
    const path = getBranchRefPath(this.rootDir, name);
    if (hash === null) {
      await unlink(path);
      await this.pruneEmptyRefDirs(dirname(path));
    } else {
      await ensureDir(dirname(path));
      await atomicWrite(path, `${hash}\n`);
    }
  }

  /** Lists branch names, including nested refs such as feature/login. */
  async listBranches(): Promise<string[]> {
    const headsDir = join(getRefsDir(this.rootDir), 'heads');
    try {
      const branches = await this.collectBranchNames(headsDir, '');
      return branches.sort();
    } catch {
      return [];
    }
  }

  async deleteBranch(name: string): Promise<void> {
    validateBranchName(name);
    const path = getBranchRefPath(this.rootDir, name);
    await unlink(path);
    await this.pruneEmptyRefDirs(dirname(path));
  }

  /** Remove all branch ref files (used when reinitializing a repository). */
  async clearBranchRefs(): Promise<void> {
    const headsDir = join(getRefsDir(this.rootDir), 'heads');
    if (!existsSync(headsDir)) {
      return;
    }
    await this.removeRefTree(headsDir);
  }

  private async collectBranchNames(dir: string, prefix: string): Promise<string[]> {
    const entries = await fsReaddir(dir, { withFileTypes: true });
    const branches: string[] = [];

    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        branches.push(...(await this.collectBranchNames(fullPath, rel)));
      } else if (entry.isFile()) {
        branches.push(rel);
      }
    }

    return branches;
  }

  private async removeRefTree(dir: string): Promise<void> {
    const entries = await fsReaddir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.removeRefTree(fullPath);
        await rmdir(fullPath).catch(() => {});
      } else {
        await unlink(fullPath);
      }
    }
  }

  private async pruneEmptyRefDirs(startDir: string): Promise<void> {
    const headsDir = join(getRefsDir(this.rootDir), 'heads');
    let current = startDir;

    while (current.startsWith(headsDir) && current !== headsDir) {
      try {
        const entries = await fsReaddir(current);
        if (entries.length > 0) {
          break;
        }
        await rmdir(current);
        current = dirname(current);
      } catch {
        break;
      }
    }
  }
}
