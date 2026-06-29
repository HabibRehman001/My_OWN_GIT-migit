import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import { MergeResolveEngine } from '../src/core/merge/merge-resolve.js';
import {
  createRepositoryLock,
  isRepositoryLocked,
  readRepositoryLock,
  releaseRepositoryLock,
} from '../src/core/repository-lock.js';
import { getRepositoryLockPath } from '../src/utils/paths.js';
import { existsSync, readFile } from '../src/utils/file-system.js';
import { MiGitError } from '../src/utils/errors.js';

async function setupContentConflictMerge(
  root: string,
  repo: Awaited<ReturnType<typeof createTempRepo>>['repo'],
) {
  await writeProjectFile(root, 'shared.txt', 'base');
  await repo.add(['shared.txt']);
  await repo.commit('base');

  await repo.createBranch('feature');
  await new CheckoutEngine(repo).checkout('feature');
  await writeProjectFile(root, 'shared.txt', 'feature');
  await repo.add(['shared.txt']);
  await repo.commit('feature');

  await new CheckoutEngine(repo).checkout('main');
  await writeProjectFile(root, 'shared.txt', 'main');
  await repo.add(['shared.txt']);
  await repo.commit('main');

  await new MergeEngine(repo).merge('feature');
}

describe('repository lock', () => {
  it('creates repository.lock with pid, operation, and startedAt during conflict merge', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);

      assert.equal(isRepositoryLocked(root), true);
      assert.equal(existsSync(getRepositoryLockPath(root)), true);

      const lock = await readRepositoryLock(root);
      assert.ok(lock);
      assert.equal(lock.operation, 'merge');
      assert.equal(lock.pid, process.pid);
      assert.ok(lock.startedAt);

      const raw = JSON.parse((await readFile(getRepositoryLockPath(root))).toString('utf8'));
      assert.equal(raw.operation, 'merge');
      assert.equal(raw.pid, process.pid);
    } finally {
      await cleanup();
    }
  });

  it('releases the lock after merge --continue', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);
      await writeProjectFile(root, 'shared.txt', 'resolved');
      await new MergeResolveEngine(repo).resolve(['shared.txt']);

      await new MergeEngine(repo).continue();
      assert.equal(isRepositoryLocked(root), false);
    } finally {
      await cleanup();
    }
  });

  it('releases the lock after merge --abort', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);

      await new MergeEngine(repo).abort();
      assert.equal(isRepositoryLocked(root), false);
    } finally {
      await cleanup();
    }
  });

  it('blocks commit and checkout while the repository lock is held', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);

      await assert.rejects(
        () => repo.commit('blocked'),
        (error: unknown) =>
          error instanceof MiGitError &&
          (error.message.includes('A merge is currently in progress') ||
            error.message.includes('Repository is locked')),
      );

      await assert.rejects(
        () => new CheckoutEngine(repo).checkout('feature'),
        (error: unknown) =>
          error instanceof MiGitError &&
          (error.message.includes('Checkout stopped.') ||
            error.message.includes('Repository is locked')),
      );
    } finally {
      await cleanup();
    }
  });

  it('fails to acquire when repository.lock already exists', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'a.txt', 'a');
      await repo.add(['a.txt']);
      await repo.commit('a');

      const first = createRepositoryLock(root, 'merge');
      await first.acquire();

      const second = createRepositoryLock(root, 'merge');
      await assert.rejects(
        () => second.acquire(),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('Repository is locked'),
      );

      await first.release();
    } finally {
      await releaseRepositoryLock(root).catch(() => {});
      await cleanup();
    }
  });
});
