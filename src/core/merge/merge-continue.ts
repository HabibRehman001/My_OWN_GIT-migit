/**
 * merge-continue.ts — finalize an in-progress merge after all conflicts are resolved.
 */

import type { Repository } from '../repository.js';
import { createCommit } from '../commit.js';
import { createSnapshot } from '../snapshot.js';
import { GenerationResolver, generationFromParents } from './generation.js';
import {
  clearMergeState,
  loadMergeMessage,
  requireMergeState,
} from './merge-state.js';
import { releaseRepositoryLock } from '../repository-lock.js';
import type { StagedEntry } from '../../types/index.js';
import { MiGitError } from '../../utils/errors.js';

export interface MergeContinueResult {
  type: 'completed';
  branch: string;
  incomingBranch: string;
  commitHash: string;
  message: string;
  ourCommit: string;
  theirCommit: string;
}

function validateIndexEntries(entries: StagedEntry[]): string[] {
  const issues: string[] = [];

  if (!Array.isArray(entries)) {
    issues.push('Index must be a JSON array');
    return issues;
  }

  for (const entry of entries) {
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      issues.push('Index entry is missing a valid path');
      continue;
    }
    if (typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash)) {
      issues.push(`Index entry "${entry.path}" has an invalid blob hash`);
      continue;
    }
    if (typeof entry.mode !== 'string' || entry.mode.length === 0) {
      issues.push(`Index entry "${entry.path}" is missing a file mode`);
    }
  }

  return issues;
}

async function assertBlobExists(
  repo: Repository,
  hash: string,
  context: string,
): Promise<void> {
  try {
    await repo.objectStore.readBlob(hash);
  } catch {
    throw new MiGitError(`Merge stopped: missing blob ${hash.slice(0, 7)} for ${context}.`);
  }
}

async function assertCommitExists(repo: Repository, hash: string, label: string): Promise<void> {
  try {
    await repo.objectStore.readCommit(hash);
  } catch {
    throw new MiGitError(`Merge stopped: ${label} commit ${hash.slice(0, 7)} no longer exists.`);
  }
}

/**
 * continueMerge — create a two-parent merge commit from the current index.
 */
export async function continueMerge(repo: Repository): Promise<MergeContinueResult> {
  try {
    const state = await requireMergeState(repo.rootDir);

  const currentBranch = await repo.getCurrentBranch();
  if (currentBranch !== state.currentBranch) {
    throw new MiGitError(
      `Merge stopped: current branch is "${currentBranch}" but the merge started on "${state.currentBranch}".`,
    );
  }

  const head = await repo.refs.getHead();
  if (head !== state.ourCommit) {
    throw new MiGitError(
      'Merge stopped: current branch tip changed since the merge started.',
    );
  }

  const unresolved = state.conflicts.filter((entry) => !entry.resolved);
  if (unresolved.length > 0) {
    throw new MiGitError(
      `Merge stopped: ${unresolved.length} unresolved conflict${unresolved.length === 1 ? '' : 's'} remain. Run "migit resolve" on each conflicted file first.`,
    );
  }

  await assertCommitExists(repo, state.ourCommit, 'current branch');
  await assertCommitExists(repo, state.theirCommit, 'incoming branch');

  const index = await repo.indexStore.load();
  const indexIssues = validateIndexEntries(index);
  if (indexIssues.length > 0) {
    throw new MiGitError(`Merge stopped: invalid index — ${indexIssues[0]}`);
  }

  for (const entry of index) {
    await assertBlobExists(repo, entry.hash, `index path "${entry.path}"`);
  }

  for (const conflict of state.conflicts) {
    const indexEntry = index.find((entry) => entry.path === conflict.path);
    if (!indexEntry) {
      throw new MiGitError(
        `Merge stopped: resolved conflict "${conflict.path}" is missing from the index.`,
      );
    }
    await assertBlobExists(repo, indexEntry.hash, `resolved conflict "${conflict.path}"`);
  }

  const message = await loadMergeMessage(repo.rootDir);
  const tree = await createSnapshot(repo.objectStore, index);
  const author = await repo.configStore.getAuthor();

  const generationResolver = new GenerationResolver(repo.objectStore, repo.rootDir);
  await generationResolver.init();
  const parentGenerations = await Promise.all([
    generationResolver.getGeneration(state.ourCommit),
    generationResolver.getGeneration(state.theirCommit),
  ]);
  const generation = generationFromParents(parentGenerations);

  const commitHash = await createCommit(repo.objectStore, {
    tree,
    parents: [state.ourCommit, state.theirCommit],
    author,
    timestamp: Date.now(),
    message,
    generation,
  });
  await generationResolver.flush();

  await repo.refs.setHead(commitHash);
  await clearMergeState(repo.rootDir);

  return {
    type: 'completed',
    branch: state.currentBranch,
    incomingBranch: state.incomingBranch,
    commitHash,
    message,
    ourCommit: state.ourCommit,
    theirCommit: state.theirCommit,
  };
  } finally {
    await releaseRepositoryLock(repo.rootDir);
  }
}
