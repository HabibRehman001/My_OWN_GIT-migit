/**
 * merge-abort.ts — cancel an in-progress merge and restore the pre-merge tree.
 */

import type { Repository } from '../repository.js';
import { clearMergeState, requireMergeState } from './merge-state.js';
import { releaseRepositoryLock } from '../repository-lock.js';
import { restoreTree, treeToIndex } from '../working-tree.js';
import { MiGitError } from '../../utils/errors.js';

export interface MergeAbortResult {
  type: 'aborted';
  branch: string;
  ourCommit: string;
}

async function assertCommitExists(repo: Repository, hash: string, label: string): Promise<void> {
  try {
    await repo.objectStore.readCommit(hash);
  } catch {
    throw new MiGitError(`Merge abort stopped: ${label} commit ${hash.slice(0, 7)} no longer exists.`);
  }
}

/**
 * abortMerge — restore working tree and index from ourCommit; clear merge metadata.
 * Never reconstructs state from conflict files — only immutable commit objects.
 */
export async function abortMerge(repo: Repository): Promise<MergeAbortResult> {
  try {
    const state = await requireMergeState(repo.rootDir);

    const currentBranch = await repo.getCurrentBranch();
    if (currentBranch !== state.currentBranch) {
      throw new MiGitError(
        `Merge abort stopped: current branch is "${currentBranch}" but the merge started on "${state.currentBranch}".`,
      );
    }

    const head = await repo.refs.getHead();
    if (head !== state.ourCommit) {
      throw new MiGitError(
        'Merge abort stopped: current branch tip changed since the merge started.',
      );
    }

    await assertCommitExists(repo, state.ourCommit, 'pre-merge');

    const ourCommit = await repo.objectStore.readCommit(state.ourCommit);
    const ourTree = await repo.objectStore.readTree(ourCommit.tree);

    for (const blobHash of ourTree.values()) {
      await repo.objectStore.readBlob(blobHash);
    }

    await restoreTree(repo, ourTree);
    await repo.indexStore.save(treeToIndex(ourTree));
    await clearMergeState(repo.rootDir);

    return {
      type: 'aborted',
      branch: state.currentBranch,
      ourCommit: state.ourCommit,
    };
  } finally {
    await releaseRepositoryLock(repo.rootDir);
  }
}
