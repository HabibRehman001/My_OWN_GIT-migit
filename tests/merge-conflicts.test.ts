import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import {
  formatMergeMessage,
  loadMergeState,
  MERGE_STATE_VERSION,
} from '../src/core/merge/merge-state.js';
import { readFile } from '../src/utils/file-system.js';
import { getMergeMsgPath, getMergeStatePath } from '../src/utils/paths.js';
import { MiGitError } from '../src/utils/errors.js';

describe('merge with conflicts', () => {
  it('stores merge state and MERGE_MSG without creating a commit', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/auth/token.ts', 'base-token');
      await writeProjectFile(root, 'package-lock.json', 'base-lock');
      await writeProjectFile(root, 'src/config.ts', 'base-config');
      await repo.add(['src/auth/token.ts', 'package-lock.json', 'src/config.ts']);
      await repo.commit('base');

      await repo.createBranch('feature-login');
      await new CheckoutEngine(repo).checkout('feature-login');
      await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
      await writeProjectFile(root, 'package-lock.json', 'feature-lock');
      await writeProjectFile(root, 'src/config.ts', 'feature-config');
      await repo.add(['src/auth/token.ts', 'package-lock.json', 'src/config.ts']);
      const featureHead = await repo.commit('feature changes');

      await new CheckoutEngine(repo).checkout('main');
      await unlink(join(root, 'src/config.ts'));
      await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
      await writeProjectFile(root, 'package-lock.json', 'main-lock');
      await repo.add(['.']);
      const mainHead = await repo.commit('main changes');

      const result = await new MergeEngine(repo).merge('feature-login');
      assert.equal(result.type, 'conflicts');
      if (result.type !== 'conflicts') {
        return;
      }

      assert.equal(result.branch, 'main');
      assert.equal(result.sourceBranch, 'feature-login');
      assert.equal(result.ourCommit, mainHead);
      assert.equal(result.theirCommit, featureHead);
      assert.equal(result.conflicts.length, 3);
      assert.equal(await repo.refs.getHead(), mainHead);
      assert.equal(await repo.refs.readBranch('main'), mainHead);
      assert.equal(await repo.refs.readBranch('feature-login'), featureHead);

      const mergeState = await loadMergeState(root);
      assert.ok(mergeState);
      assert.equal(mergeState.version, MERGE_STATE_VERSION);
      assert.equal(mergeState.currentBranch, 'main');
      assert.equal(mergeState.incomingBranch, 'feature-login');
      assert.equal(mergeState.ourCommit, mainHead);
      assert.equal(mergeState.theirCommit, featureHead);
      assert.ok(mergeState.baseCommit);
      assert.ok(mergeState.startedAt);
      assert.equal(mergeState.conflicts.length, 3);

      const tokenConflict = mergeState.conflicts.find(
        (entry) => entry.path === 'src/auth/token.ts',
      );
      assert.ok(tokenConflict);
      assert.equal(tokenConflict.type, 'content');
      assert.equal(tokenConflict.resolved, false);
      assert.ok(tokenConflict.ourHash);
      assert.ok(tokenConflict.theirHash);
      assert.ok(tokenConflict.baseHash);

      const mergeMsg = (await readFile(getMergeMsgPath(root))).toString('utf8');
      assert.equal(mergeMsg, `${formatMergeMessage('feature-login', 'main')}\n`);

      const rawState = JSON.parse(
        (await readFile(getMergeStatePath(root))).toString('utf8'),
      );
      assert.equal(rawState.version, 1);
      assert.equal(rawState.incomingBranch, 'feature-login');
    } finally {
      await cleanup();
    }
  });

  it('writes conflict markers into the working tree for content conflicts', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/auth/token.ts', 'base-token');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('base');

      await repo.createBranch('feature-login');
      await new CheckoutEngine(repo).checkout('feature-login');
      await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('main');

      await new MergeEngine(repo).merge('feature-login');

      const working = (await readFile(join(root, 'src/auth/token.ts'))).toString('utf8');
      assert.match(working, /^<<<<<<< current:main/);
      assert.ok(working.includes('main-token'));
      assert.ok(working.includes('base-token'));
      assert.ok(working.includes('feature-token'));
      assert.match(working, />>>>>>> incoming:feature-login$/m);
    } finally {
      await cleanup();
    }
  });

  it('blocks a new merge while merge state exists', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
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

      const first = await new MergeEngine(repo).merge('feature');
      assert.equal(first.type, 'conflicts');

      await assert.rejects(
        () => new MergeEngine(repo).merge('feature'),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('A merge is currently in progress'),
      );
    } finally {
      await cleanup();
    }
  });
});
