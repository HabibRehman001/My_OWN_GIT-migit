import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import { MergeResolveEngine } from '../src/core/merge/merge-resolve.js';
import { hasConflictMarkers } from '../src/core/merge/conflict-markers.js';
import { isMergeInProgress } from '../src/core/merge/merge-state.js';
import { createCommit } from '../src/core/commit.js';
import { createSnapshot } from '../src/core/snapshot.js';
import { readFile } from '../src/utils/file-system.js';
import { getMergeMsgPath, getMergeStatePath } from '../src/utils/paths.js';
import { existsSync } from '../src/utils/file-system.js';
import { MiGitError } from '../src/utils/errors.js';

async function setupContentConflictMerge(
  root: string,
  repo: Awaited<ReturnType<typeof createTempRepo>>['repo'],
) {
  await writeProjectFile(root, 'src/auth/token.ts', 'base-token');
  await writeProjectFile(root, 'package-lock.json', 'base-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  await repo.commit('base');

  await repo.createBranch('feature/login');
  await new CheckoutEngine(repo).checkout('feature/login');
  await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
  await writeProjectFile(root, 'package-lock.json', 'feature-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  await repo.commit('feature');

  await new CheckoutEngine(repo).checkout('main');
  await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
  await writeProjectFile(root, 'package-lock.json', 'main-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  const mainHead = await repo.commit('main');

  await new MergeEngine(repo).merge('feature/login');

  return { mainHead };
}

describe('merge abort', () => {
  it('restores working tree and index from ourCommit and clears merge state', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const { mainHead } = await setupContentConflictMerge(root, repo);

      const marked = (await readFile(join(root, 'src/auth/token.ts'))).toString('utf8');
      assert.equal(hasConflictMarkers(marked), true);

      const result = await new MergeEngine(repo).abort();
      assert.equal(result.type, 'aborted');
      assert.equal(result.branch, 'main');
      assert.equal(result.ourCommit, mainHead);

      assert.equal(await repo.refs.getHead(), mainHead);
      assert.equal(await repo.getCurrentBranch(), 'main');
      assert.equal(isMergeInProgress(root), false);
      assert.equal(existsSync(getMergeStatePath(root)), false);
      assert.equal(existsSync(getMergeMsgPath(root)), false);

      assert.equal(
        (await readFile(join(root, 'src/auth/token.ts'))).toString('utf8'),
        'main-token',
      );
      assert.equal(
        (await readFile(join(root, 'package-lock.json'))).toString('utf8'),
        'main-lock',
      );

      const index = await repo.indexStore.load();
      const tokenEntry = index.find((entry) => entry.path === 'src/auth/token.ts');
      assert.ok(tokenEntry);
      assert.equal(
        (await repo.objectStore.readBlob(tokenEntry.hash)).toString('utf8'),
        'main-token',
      );
    } finally {
      await cleanup();
    }
  });

  it('restores from ourCommit even when conflicts were partially resolved', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const { mainHead } = await setupContentConflictMerge(root, repo);

      await writeProjectFile(root, 'src/auth/token.ts', 'user-resolved-token');
      await new MergeResolveEngine(repo).resolve(['src/auth/token.ts']);

      const result = await new MergeEngine(repo).abort();
      assert.equal(result.ourCommit, mainHead);
      assert.equal(
        (await readFile(join(root, 'src/auth/token.ts'))).toString('utf8'),
        'main-token',
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects abort when no merge is in progress', async () => {
    const { repo, cleanup } = await createTempRepo();
    try {
      await assert.rejects(
        () => new MergeEngine(repo).abort(),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('no merge is in progress'),
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects abort when the branch tip changed since the merge started', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const { mainHead } = await setupContentConflictMerge(root, repo);

      const index = await repo.indexStore.load();
      const tree = await createSnapshot(repo.objectStore, index);
      const author = await repo.configStore.getAuthor();
      const movedHead = await createCommit(repo.objectStore, {
        tree,
        parents: [mainHead],
        author,
        timestamp: Date.now(),
        message: 'simulated tip move',
      });
      await repo.refs.setHead(movedHead);
      assert.notEqual(movedHead, mainHead);

      await assert.rejects(
        () => new MergeEngine(repo).abort(),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('branch tip changed'),
      );
    } finally {
      await cleanup();
    }
  });
});
