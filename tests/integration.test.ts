import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { readFile } from '../src/utils/file-system.js';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

describe('checkout restoration integration', () => {
  it('restores target branch files and removes files absent from target tree', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'shared.txt', 'v1');
      await writeProjectFile(root, 'main-only.txt', 'main');
      await repo.add(['.']);
      await repo.commit('on main');

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'feature-only.txt', 'feature');
      await repo.add(['feature-only.txt']);
      await repo.commit('on feature');

      await new CheckoutEngine(repo).checkout('main', { force: true });

      const shared = await readFile(join(root, 'shared.txt'));
      const mainOnly = await readFile(join(root, 'main-only.txt'));
      assert.equal(shared.toString('utf8'), 'v1');
      assert.equal(mainOnly.toString('utf8'), 'main');

      await assert.rejects(() => readFile(join(root, 'feature-only.txt')));
    } finally {
      await cleanup();
    }
  });

  it('blocks checkout when dirty and allows with force', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      await repo.createBranch('bugfix/other-task');
      await writeProjectFile(root, 'dirty.txt', 'change');
      await repo.add(['dirty.txt']);

      await assert.rejects(() => new CheckoutEngine(repo).checkout('bugfix/other-task'));
      await new CheckoutEngine(repo).checkout('bugfix/other-task', { force: true });
      assert.equal(await repo.getCurrentBranch(), 'bugfix/other-task');
    } finally {
      await cleanup();
    }
  });
});

describe('path guard', () => {
  it('rejects paths outside repository root', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await assert.rejects(() => repo.add(['../outside.txt']));
    } finally {
      await cleanup();
    }
  });
});
