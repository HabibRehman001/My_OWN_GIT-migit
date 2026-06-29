/**
 * checkout-engine.ts — full branch checkout with working tree restoration.
 */

import type { Repository } from './repository.js';
import { StatusEngine } from './status-engine.js';
import {
  findCheckoutBlockers,
  formatCheckoutBlockedMessage,
} from './checkout-guard.js';
import { MiGitError } from '../utils/errors.js';
import { restoreTree, treeToIndex } from './working-tree.js';
import { assertNoMergeDuringCheckout } from './merge/merge-guard.js';
import { assertRepositoryUnlockedAsync } from './repository-lock.js';

export interface CheckoutOptions {
  force?: boolean;
}

export class CheckoutEngine {
  constructor(private readonly repo: Repository) {}

  async checkout(target: string, options: CheckoutOptions = {}): Promise<void> {
    this.repo.assertInitialized();
    assertNoMergeDuringCheckout(this.repo.rootDir);
    await assertRepositoryUnlockedAsync(this.repo.rootDir);

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

    await restoreTree(this.repo, tree);
    await this.repo.indexStore.save(treeToIndex(tree));
    await this.repo.refs.setCurrentBranch(target);

    console.log(`Switched to branch '${target}'`);
  }
}
