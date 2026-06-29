/**
 * merge-engine.ts — branch merge operations (fast-forward first).
 */

import type { Repository } from '../repository.js';
import { isAncestor } from './ancestry.js';
import { findMergeBase } from './merge-base.js';
import { resolveMergeBranches } from './merge-common.js';
import {
  computeMergePreview,
  type MergePreviewResult,
} from './merge-preview.js';
import {
  loadMergeTrees,
  mergeTrees,
} from './tree-merge.js';
import type { MergeConflict } from './merge-types.js';
import { assertNoMergeDuringMerge } from './merge-guard.js';
import {
  mergeConflictsToStateConflicts,
  MERGE_STATE_VERSION,
  formatMergeMessage,
  saveMergeMsg,
  saveMergeState,
} from './merge-state.js';
import { continueMerge } from './merge-continue.js';
import type { MergeContinueResult } from './merge-continue.js';
import { abortMerge } from './merge-abort.js';
import type { MergeAbortResult } from './merge-abort.js';
import {
  countTreeChanges,
  restoreTree,
  treeToIndex,
} from '../working-tree.js';
import { StatusEngine } from '../status-engine.js';
import {
  findCheckoutBlockers,
  formatCheckoutBlockedMessage,
} from '../checkout-guard.js';
import {
  assertRepositoryUnlockedAsync,
  createRepositoryLock,
} from '../repository-lock.js';
import { MiGitError } from '../../utils/errors.js';

export type FastForwardMergeResult = {
  type: 'fast-forward';
  branch: string;
  from: string;
  to: string;
  filesUpdated: number;
};

export type AlreadyUpToDateResult = {
  type: 'already-up-to-date';
  branch: string;
  sourceBranch: string;
};

export type MergeConflictsResult = {
  type: 'conflicts';
  branch: string;
  sourceBranch: string;
  baseCommit: string;
  ourCommit: string;
  theirCommit: string;
  conflicts: MergeConflict[];
};

export type MergeResult =
  | FastForwardMergeResult
  | AlreadyUpToDateResult
  | MergeConflictsResult;

export interface MergeOptions {
  force?: boolean;
}

export class MergeEngine {
  constructor(private readonly repo: Repository) {}

  /** Read-only merge analysis — does not modify refs, index, or working tree. */
  async preview(branchName: string): Promise<MergePreviewResult> {
    return computeMergePreview(this.repo, branchName);
  }

  /** Complete an in-progress merge after all conflicts are resolved. */
  async continue(): Promise<MergeContinueResult> {
    return continueMerge(this.repo);
  }

  /** Cancel an in-progress merge and restore the pre-merge tree from ourCommit. */
  async abort(): Promise<MergeAbortResult> {
    return abortMerge(this.repo);
  }

  async merge(branchName: string, options: MergeOptions = {}): Promise<MergeResult> {
    assertNoMergeDuringMerge(this.repo.rootDir);
    await assertRepositoryUnlockedAsync(this.repo.rootDir);

    const { currentBranch, incomingBranch, ourHead, theirHead } =
      await resolveMergeBranches(this.repo, branchName);

    if (ourHead === theirHead) {
      return {
        type: 'already-up-to-date',
        branch: currentBranch,
        sourceBranch: incomingBranch,
      };
    }

    const ancestryOptions = { rootDir: this.repo.rootDir };

    const alreadyMerged = await isAncestor(
      this.repo.objectStore,
      theirHead,
      ourHead,
      ancestryOptions,
    );

    if (alreadyMerged) {
      return {
        type: 'already-up-to-date',
        branch: currentBranch,
        sourceBranch: incomingBranch,
      };
    }

    const canFastForward = await isAncestor(
      this.repo.objectStore,
      ourHead,
      theirHead,
      ancestryOptions,
    );

    if (!canFastForward) {
      return this.mergeThreeWay(
        {
          currentBranch,
          incomingBranch,
          ourHead,
          theirHead,
        },
        options,
      );
    }

    const theirCommit = await this.repo.objectStore.readCommit(theirHead);
    const theirTree = await this.repo.objectStore.readTree(theirCommit.tree);

    const ourCommit = await this.repo.objectStore.readCommit(ourHead);
    const ourTree = await this.repo.objectStore.readTree(ourCommit.tree);

    for (const blobHash of theirTree.values()) {
      await this.repo.objectStore.readBlob(blobHash);
    }

    if (!options.force) {
      const status = await new StatusEngine(this.repo).getStatus();
      const blockers = findCheckoutBlockers(status, theirTree);
      if (blockers.length > 0) {
        throw new MiGitError(
          formatCheckoutBlockedMessage(blockers).replace('Checkout stopped.', 'Merge stopped.'),
        );
      }
    }

    const filesUpdated = countTreeChanges(ourTree, theirTree);

    const lock = createRepositoryLock(this.repo.rootDir, 'merge');
    await lock.acquire();
    try {
      await restoreTree(this.repo, theirTree);
      await this.repo.indexStore.save(treeToIndex(theirTree));
      await this.repo.refs.setHead(theirHead);

      return {
        type: 'fast-forward',
        branch: currentBranch,
        from: ourHead,
        to: theirHead,
        filesUpdated,
      };
    } finally {
      await lock.release();
    }
  }

  private async mergeThreeWay(
    context: {
      currentBranch: string;
      incomingBranch: string;
      ourHead: string;
      theirHead: string;
    },
    options: MergeOptions,
  ): Promise<MergeResult> {
    const { currentBranch, incomingBranch, ourHead, theirHead } = context;
    const ancestryOptions = { rootDir: this.repo.rootDir };

    const lock = createRepositoryLock(this.repo.rootDir, 'merge');
    await lock.acquire();
    let keepLock = false;

    try {
    const mergeBase = await findMergeBase(
      this.repo.objectStore,
      ourHead,
      theirHead,
      ancestryOptions,
    );

    const { baseTree, ourTree, theirTree } = await loadMergeTrees(
      this.repo.objectStore,
      mergeBase,
      ourHead,
      theirHead,
    );

    const treeMerge = await mergeTrees(
      this.repo.objectStore,
      baseTree,
      ourTree,
      theirTree,
      { currentBranch, incomingBranch },
    );

    for (const blobHash of treeMerge.mergedFiles.values()) {
      await this.repo.objectStore.readBlob(blobHash);
    }

    if (!options.force) {
      const status = await new StatusEngine(this.repo).getStatus();
      const blockers = findCheckoutBlockers(status, treeMerge.mergedFiles);
      if (blockers.length > 0) {
        throw new MiGitError(
          formatCheckoutBlockedMessage(blockers).replace('Checkout stopped.', 'Merge stopped.'),
        );
      }
    }

    if (treeMerge.conflicts.length === 0) {
      throw new MiGitError(
        'Merge stopped: automatic three-way merge succeeded but merge commits are not yet supported.',
      );
    }

    await restoreTree(this.repo, treeMerge.mergedFiles);
    await this.repo.indexStore.save(treeToIndex(treeMerge.mergedFiles));

    const startedAt = new Date().toISOString();
    await saveMergeState(this.repo.rootDir, {
      version: MERGE_STATE_VERSION,
      currentBranch,
      incomingBranch,
      baseCommit: mergeBase,
      ourCommit: ourHead,
      theirCommit: theirHead,
      startedAt,
      conflicts: mergeConflictsToStateConflicts(treeMerge.conflicts),
    });
    await saveMergeMsg(
      this.repo.rootDir,
      formatMergeMessage(incomingBranch, currentBranch),
    );

    keepLock = true;

    return {
      type: 'conflicts',
      branch: currentBranch,
      sourceBranch: incomingBranch,
      baseCommit: mergeBase,
      ourCommit: ourHead,
      theirCommit: theirHead,
      conflicts: treeMerge.conflicts,
    };
    } finally {
      if (!keepLock) {
        await lock.release();
      }
    }
  }
}
