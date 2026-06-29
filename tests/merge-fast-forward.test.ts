import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import { readFile } from '../src/utils/file-system.js';
import { MiGitError } from '../src/utils/errors.js';

describe('fast-forward merge', () => {
  it('advances the current branch when it is behind the merged branch', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'shared.txt', 'A');
      await repo.add(['shared.txt']);
      await repo.commit('A');

      await writeProjectFile(root, 'main.txt', 'B');
      await repo.add(['main.txt']);
      const commitB = await repo.commit('B');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      await writeProjectFile(root, 'feature-one.txt', 'C');
      await repo.add(['feature-one.txt']);
      await repo.commit('C');
      await writeProjectFile(root, 'feature-two.txt', 'D');
      await repo.add(['feature-two.txt']);
      const commitD = await repo.commit('D');

      await new CheckoutEngine(repo).checkout('main');
      assert.equal(await repo.refs.readBranch('main'), commitB);

      const result = await new MergeEngine(repo).merge('feature');
      assert.equal(result.type, 'fast-forward');
      if (result.type === 'fast-forward') {
        assert.equal(result.from, commitB);
        assert.equal(result.to, commitD);
        assert.equal(result.branch, 'main');
        assert.equal(result.filesUpdated, 2);
      }

      assert.equal(await repo.refs.readBranch('main'), commitD);
      assert.equal(await repo.refs.readBranch('feature'), commitD);
      assert.equal(await repo.getCurrentBranch(), 'main');

      assert.equal((await readFile(join(root, 'shared.txt'))).toString('utf8'), 'A');
      assert.equal((await readFile(join(root, 'main.txt'))).toString('utf8'), 'B');
      assert.equal((await readFile(join(root, 'feature-one.txt'))).toString('utf8'), 'C');
      assert.equal((await readFile(join(root, 'feature-two.txt'))).toString('utf8'), 'D');

      const index = await repo.indexStore.load();
      assert.equal(index.length, 4);
    } finally {
      await cleanup();
    }
  });

  it('reports already up to date when branches point at the same commit', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'a.txt', 'a');
      await repo.add(['a.txt']);
      await repo.commit('initial');

      await repo.createBranch('feature');
      const result = await new MergeEngine(repo).merge('feature');
      assert.equal(result.type, 'already-up-to-date');
      if (result.type === 'already-up-to-date') {
        assert.equal(result.branch, 'main');
        assert.equal(result.sourceBranch, 'feature');
      }
    } finally {
      await cleanup();
    }
  });

  it('reports already up to date when source branch is behind current branch', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'a.txt', 'A');
      await repo.add(['a.txt']);
      await repo.commit('A');

      await writeProjectFile(root, 'b.txt', 'B');
      await repo.add(['b.txt']);
      await repo.commit('B');

      await writeProjectFile(root, 'c.txt', 'C');
      await repo.add(['c.txt']);
      await repo.commit('C');

      await repo.createBranch('feature');

      await writeProjectFile(root, 'd.txt', 'D');
      await repo.add(['d.txt']);
      const mainHead = await repo.commit('D');

      const result = await new MergeEngine(repo).merge('feature');
      assert.equal(result.type, 'already-up-to-date');
      if (result.type === 'already-up-to-date') {
        assert.equal(result.branch, 'main');
        assert.equal(result.sourceBranch, 'feature');
      }

      assert.equal(await repo.refs.getHead(), mainHead);
      assert.equal((await readFile(join(root, 'd.txt'))).toString('utf8'), 'D');
    } finally {
      await cleanup();
    }
  });

  it('rejects clean diverged merges until merge commits are supported', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('base');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      await writeProjectFile(root, 'on-feature.txt', 'feature');
      await repo.add(['on-feature.txt']);
      await repo.commit('on feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'on-main.txt', 'main');
      await repo.add(['on-main.txt']);
      await repo.commit('on main');

      await assert.rejects(
        () => new MergeEngine(repo).merge('feature'),
        (error: unknown) =>
          error instanceof MiGitError &&
          error.message.includes('merge commits are not yet supported'),
      );
      assert.equal(await repo.getCurrentBranch(), 'main');
    } finally {
      await cleanup();
    }
  });

  it('blocks merge when the working tree has uncommitted changes', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('base');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      await writeProjectFile(root, 'feature.txt', 'feature');
      await repo.add(['feature.txt']);
      await repo.commit('feature work');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'dirty.txt', 'dirty');
      await repo.add(['dirty.txt']);

      await assert.rejects(
        () => new MergeEngine(repo).merge('feature'),
        (error: unknown) => error instanceof MiGitError,
      );
    } finally {
      await cleanup();
    }
  });
});
