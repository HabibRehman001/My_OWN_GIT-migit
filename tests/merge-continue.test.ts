import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import { MergeResolveEngine } from '../src/core/merge/merge-resolve.js';
import {
  formatMergeMessage,
  isMergeInProgress,
  loadMergeState,
} from '../src/core/merge/merge-state.js';
import { getMergeMsgPath, getMergeStatePath } from '../src/utils/paths.js';
import { existsSync } from '../src/utils/file-system.js';
import { createCommit } from '../src/core/commit.js';
import { createSnapshot } from '../src/core/snapshot.js';
import { MiGitError } from '../src/utils/errors.js';

async function setupContentConflictMerge(
  root: string,
  repo: Awaited<ReturnType<typeof createTempRepo>>['repo'],
) {
  await writeProjectFile(root, 'src/auth/token.ts', 'base-token');
  await writeProjectFile(root, 'package-lock.json', 'base-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  await repo.commit('base');

  await repo.createBranch('feature-login');
  await new CheckoutEngine(repo).checkout('feature-login');
  await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
  await writeProjectFile(root, 'package-lock.json', 'feature-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  const featureHead = await repo.commit('feature');

  await new CheckoutEngine(repo).checkout('main');
  await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
  await writeProjectFile(root, 'package-lock.json', 'main-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  const mainHead = await repo.commit('main');

  await new MergeEngine(repo).merge('feature-login');

  return { mainHead, featureHead };
}

async function resolveAllConflicts(
  root: string,
  repo: Awaited<ReturnType<typeof createTempRepo>>['repo'],
) {
  await writeProjectFile(root, 'src/auth/token.ts', 'resolved-token');
  await writeProjectFile(root, 'package-lock.json', 'resolved-lock');
  await new MergeResolveEngine(repo).resolve([
    'src/auth/token.ts',
    'package-lock.json',
  ]);
}

describe('merge continue', () => {
  it('creates a two-parent merge commit and clears merge state', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const { mainHead, featureHead } = await setupContentConflictMerge(root, repo);
      await resolveAllConflicts(root, repo);

      const result = await new MergeEngine(repo).continue();
      assert.equal(result.type, 'completed');
      assert.equal(result.branch, 'main');
      assert.equal(result.incomingBranch, 'feature-login');
      assert.equal(result.ourCommit, mainHead);
      assert.equal(result.theirCommit, featureHead);
      assert.equal(
        result.message,
        formatMergeMessage('feature-login', 'main'),
      );

      assert.equal(await repo.refs.getHead(), result.commitHash);
      assert.equal(await repo.refs.readBranch('main'), result.commitHash);
      assert.equal(await repo.refs.readBranch('feature-login'), featureHead);
      assert.equal(isMergeInProgress(root), false);
      assert.equal(existsSync(getMergeStatePath(root)), false);
      assert.equal(existsSync(getMergeMsgPath(root)), false);

      const commit = await repo.objectStore.readCommit(result.commitHash);
      assert.deepEqual(commit.parents, [mainHead, featureHead]);
      assert.equal(commit.message, result.message);
      assert.ok(commit.tree);

      const tree = await repo.objectStore.readTree(commit.tree);
      assert.equal(
        (await repo.objectStore.readBlob(tree.get('src/auth/token.ts')!)).toString('utf8'),
        'resolved-token',
      );
      assert.equal(
        (await repo.objectStore.readBlob(tree.get('package-lock.json')!)).toString('utf8'),
        'resolved-lock',
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects continue while unresolved conflicts remain', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);
      await writeProjectFile(root, 'src/auth/token.ts', 'resolved-token');
      await new MergeResolveEngine(repo).resolve(['src/auth/token.ts']);

      await assert.rejects(
        () => new MergeEngine(repo).continue(),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('unresolved conflict'),
      );

      assert.ok(isMergeInProgress(root));
    } finally {
      await cleanup();
    }
  });

  it('rejects continue when no merge is in progress', async () => {
    const { repo, cleanup } = await createTempRepo();
    try {
      await assert.rejects(
        () => new MergeEngine(repo).continue(),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('no merge is in progress'),
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects continue when the branch tip changed since the merge started', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const { mainHead } = await setupContentConflictMerge(root, repo);
      await resolveAllConflicts(root, repo);

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

      const mergeState = await loadMergeState(root);
      assert.equal(mergeState?.ourCommit, mainHead);

      await assert.rejects(
        () => new MergeEngine(repo).continue(),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('branch tip changed'),
      );
    } finally {
      await cleanup();
    }
  });
});
