/**
 * checkout-engine.ts — full branch checkout with working tree restoration.
 */

import type { Repository } from './repository.js';
import { StatusEngine } from './status-engine.js';
import {
  findCheckoutBlockers,
  formatCheckoutBlockedMessage,
} from './checkout-guard.js';
import type { StagedEntry } from '../types/index.js';
import { MiGitError } from '../utils/errors.js';
import { writeFile, unlink } from '../utils/file-system.js';
import { join } from 'node:path';

export interface CheckoutOptions {
  force?: boolean;
}

export class CheckoutEngine {
  constructor(private readonly repo: Repository) {}

  async checkout(target: string, options: CheckoutOptions = {}): Promise<void> {
    this.repo.assertInitialized();

    const branches = await this.repo.listBranches();
    if (!branches.includes(target)) {
      throw new MiGitError(`pathspec '${target}' did not match any file(s) or branch`);
    }

    const commitHash = await this.repo.refs.readBranch(target);
    if (!commitHash) {
      throw new MiGitError(`Branch '${target}' has no commits yet`);
    }

    const commit = await this.repo.objectStore.readCommit(commitHash);
    const tree = await this.repo.objectStore.readTree(commit.tree);

    if (!options.force) {
      const status = await new StatusEngine(this.repo).getStatus();
      const blockers = findCheckoutBlockers(status, tree);
      if (blockers.length > 0) {
        throw new MiGitError(formatCheckoutBlockedMessage(blockers));
      }
    }

    await this.restoreTree(tree);
    await this.repo.indexStore.save(this.treeToIndex(tree));
    await this.repo.refs.setCurrentBranch(target);

    console.log(`Switched to branch '${target}'`);
  }

  private treeToIndex(tree: Map<string, string>): StagedEntry[] {
    return [...tree.entries()]
      .map(([path, hash]) => ({ path, hash, mode: '100644' }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private async restoreTree(tree: Map<string, string>): Promise<void> {
    const currentIndex = await this.repo.indexStore.load();
    const targetPaths = new Set(tree.keys());

    for (const entry of currentIndex) {
      if (targetPaths.has(entry.path)) continue;
      const full = join(this.repo.rootDir, entry.path);
      try {
        await unlink(full);
      } catch {
        // already removed
      }
    }

    for (const [relPath, hash] of tree) {
      const content = await this.repo.objectStore.readBlob(hash);
      await writeFile(join(this.repo.rootDir, relPath), content);
    }
  }
}
