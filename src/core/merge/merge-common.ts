/**
 * merge-common.ts — shared branch resolution for merge and preview.
 */

import type { Repository } from '../repository.js';
import { MiGitError } from '../../utils/errors.js';

export interface MergeBranchesContext {
  currentBranch: string;
  incomingBranch: string;
  ourHead: string;
  theirHead: string;
}

export async function resolveMergeBranches(
  repo: Repository,
  branchName: string,
): Promise<MergeBranchesContext> {
  repo.assertInitialized();

  const branches = await repo.listBranches();
  if (!branches.includes(branchName)) {
    throw new MiGitError(`branch '${branchName}' not found`);
  }

  const currentBranch = await repo.getCurrentBranch();
  if (currentBranch === branchName) {
    throw new MiGitError(`Cannot merge branch '${branchName}' into itself`);
  }

  const ourHead = await repo.refs.getHead();
  const theirHead = await repo.refs.readBranch(branchName);

  if (!theirHead) {
    throw new MiGitError(`Branch '${branchName}' has no commits yet`);
  }

  if (!ourHead) {
    throw new MiGitError('Current branch has no commits yet');
  }

  return {
    currentBranch,
    incomingBranch: branchName,
    ourHead,
    theirHead,
  };
}
