import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import { StatusEngine } from '../src/core/status-engine.js';
import { formatMergeInProgressGuidance } from '../src/core/merge/merge-guard.js';
import { MiGitError } from '../src/utils/errors.js';

async function startConflictMerge(root: string, repo: Awaited<ReturnType<typeof createTempRepo>>['repo']) {
  await writeProjectFile(root, 'shared.txt', 'base');
  await repo.add(['shared.txt']);
  await repo.commit('base');

  await repo.createBranch('feature/sample');
  await new CheckoutEngine(repo).checkout('feature/sample');
  await writeProjectFile(root, 'shared.txt', 'feature');
  await repo.add(['shared.txt']);
  await repo.commit('feature');

  await new CheckoutEngine(repo).checkout('main');
  await writeProjectFile(root, 'shared.txt', 'main');
  await repo.add(['shared.txt']);
  await repo.commit('main');

  await new MergeEngine(repo).merge('feature/sample');
}

describe('merge in progress guards', () => {
  it('blocks commit with merge guidance message', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await startConflictMerge(root, repo);

      await assert.rejects(
        () => repo.commit('manual commit during merge'),
        (error: unknown) => {
          assert.ok(error instanceof MiGitError);
          assert.equal(error.message, formatMergeInProgressGuidance());
          return true;
        },
      );
    } finally {
      await cleanup();
    }
  });

  it('blocks checkout during merge', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await startConflictMerge(root, repo);

      await assert.rejects(
        () => new CheckoutEngine(repo).checkout('feature/sample'),
        (error: unknown) =>
          error instanceof MiGitError &&
          error.message.includes('Checkout stopped.') &&
          error.message.includes('migit merge --continue'),
      );
    } finally {
      await cleanup();
    }
  });

  it('blocks branch delete during merge', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await startConflictMerge(root, repo);

      await assert.rejects(
        () => repo.deleteBranch('feature/sample'),
        (error: unknown) =>
          error instanceof MiGitError &&
          error.message.includes('Branch delete stopped.') &&
          error.message.includes('migit merge --abort'),
      );
    } finally {
      await cleanup();
    }
  });

  it('blocks merging another branch during merge', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await startConflictMerge(root, repo);

      await assert.rejects(
        () => new MergeEngine(repo).merge('feature/sample'),
        (error: unknown) =>
          error instanceof MiGitError &&
          error.message.includes('Merge stopped.') &&
          error.message.includes('A merge is currently in progress'),
      );
    } finally {
      await cleanup();
    }
  });

  it('allows status and add during merge', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await startConflictMerge(root, repo);

      await writeProjectFile(root, 'notes.txt', 'note');
      await repo.add(['notes.txt']);
      await new StatusEngine(repo).getStatus();
    } finally {
      await cleanup();
    }
  });
});
