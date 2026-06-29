import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import {
  computeMergePreview,
  formatMergePreview,
} from '../src/core/merge/merge-preview.js';

describe('merge preview command flow', () => {
  it('previews a clean three-way merge without changing refs or index', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'unchanged.txt', 'same');
      await writeProjectFile(root, 'shared.txt', 'base');
      await repo.add(['unchanged.txt', 'shared.txt']);
      await repo.commit('base');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      await writeProjectFile(root, 'feature-only.txt', 'feature');
      await repo.add(['feature-only.txt']);
      await repo.commit('on feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'main-only.txt', 'main');
      await repo.add(['main-only.txt']);
      await repo.commit('on main');

      const headBefore = await repo.refs.getHead();
      const indexBefore = await repo.indexStore.load();

      const preview = await computeMergePreview(repo, 'feature');
      assert.equal(preview.mergeType, 'three-way-clean');
      assert.equal(preview.counts?.unchanged, 2);
      assert.equal(preview.counts?.changedOnlyOurs, 1);
      assert.equal(preview.counts?.changedOnlyTheirs, 1);
      assert.equal(preview.counts?.changedBoth, 0);
      assert.equal(preview.counts?.conflicts, 0);

      const output = formatMergePreview(preview);
      assert.match(output, /Merge preview/);
      assert.match(output, /Three-way clean merge/);
      assert.match(output, /No files were changed\./);

      assert.equal(await repo.refs.getHead(), headBefore);
      assert.deepEqual(await repo.indexStore.load(), indexBefore);
    } finally {
      await cleanup();
    }
  });

  it('previews predicted conflicts on diverged branches', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/auth/token.ts', 'base');
      await writeProjectFile(root, 'package-lock.json', 'base-lock');
      await writeProjectFile(root, 'src/config.ts', 'base-config');
      await repo.add(['src/auth/token.ts', 'package-lock.json', 'src/config.ts']);
      await repo.commit('base');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
      await writeProjectFile(root, 'package-lock.json', 'feature-lock');
      await writeProjectFile(root, 'src/config.ts', 'feature-config');
      await repo.add(['src/auth/token.ts', 'package-lock.json', 'src/config.ts']);
      await repo.commit('feature changes');

      await new CheckoutEngine(repo).checkout('main');
      await unlink(join(root, 'src/config.ts'));
      await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
      await writeProjectFile(root, 'package-lock.json', 'main-lock');
      await repo.add(['.']);
      await repo.commit('main changes');

      const preview = await new MergeEngine(repo).preview('feature');
      assert.equal(preview.mergeType, 'three-way-conflicts');
      assert.equal(preview.conflicts.length, 3);

      const output = formatMergePreview(preview);
      assert.match(output, /Potential conflicts:/);
      assert.match(output, /src\/auth\/token\.ts\s+modified by both branches/);
      assert.match(output, /package-lock\.json\s+modified by both branches/);
      assert.match(output, /src\/config\.ts\s+modified\/deleted conflict/);
    } finally {
      await cleanup();
    }
  });

  it('previews fast-forward without mutating the repository', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'a.txt', 'A');
      await repo.add(['a.txt']);
      await repo.commit('A');

      await writeProjectFile(root, 'b.txt', 'B');
      await repo.add(['b.txt']);
      const mainBefore = await repo.commit('B');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      await writeProjectFile(root, 'c.txt', 'C');
      await repo.add(['c.txt']);
      await repo.commit('C');

      await new CheckoutEngine(repo).checkout('main');
      const preview = await computeMergePreview(repo, 'feature');
      assert.equal(preview.mergeType, 'fast-forward');
      assert.equal(preview.fastForwardFilesUpdated, 1);
      assert.equal(await repo.refs.getHead(), mainBefore);
    } finally {
      await cleanup();
    }
  });
});
