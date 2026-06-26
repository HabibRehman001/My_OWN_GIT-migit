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

import { readFile, readdir, unlink } from '../utils/file-system.js';
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
    } else {
      await atomicWrite(path, `${hash}\n`);
    }
  }

  async listBranches(): Promise<string[]> {
    const dir = `${getRefsDir(this.rootDir)}/heads`;
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }

  async deleteBranch(name: string): Promise<void> {
    validateBranchName(name);
    await unlink(getBranchRefPath(this.rootDir, name));
  }

  /** Remove all branch ref files (used when reinitializing a repository). */
  async clearBranchRefs(): Promise<void> {
    for (const branch of await this.listBranches()) {
      const path = getBranchRefPath(this.rootDir, branch);
      if (existsSync(path)) {
        await unlink(path);
      }
    }
  }
}
