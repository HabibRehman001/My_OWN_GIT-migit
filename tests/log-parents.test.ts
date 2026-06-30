import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';

describe('log first-parent chain', () => {
  it('repository.log follows parents[0] through a merge commit', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      const rootHash = await repo.commit('root');

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'feature.txt', 'feature');
      await repo.add(['feature.txt']);
      const featureTip = await repo.commit('on feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'main.txt', 'main');
      await repo.add(['main.txt']);
      const mainTip = await repo.commit('on main');

      const treeHash = await repo.objectStore.writeTree({ 'merged.txt': await repo.objectStore.writeBlob(Buffer.from('x')) });
      const mergeHash = await repo.objectStore.writeCommit({
        tree: treeHash,
        parents: [mainTip, featureTip],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'Merge branch feature into main',
        generation: 3,
      });
      await repo.refs.setHead(mergeHash);

      const log = await repo.log(5);
      assert.equal(log[0]?.hash, mergeHash);
      assert.deepEqual(log[0]?.parents, [mainTip, featureTip]);
      assert.equal(log[1]?.hash, mainTip);
      assert.equal(log[2]?.hash, rootHash);
    } finally {
      await cleanup();
    }
  });
});
