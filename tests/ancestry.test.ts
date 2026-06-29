import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { isAncestor, collectAncestors } from '../src/core/merge/ancestry.js';
import { findMergeBase } from '../src/core/merge/merge-base.js';
import { MiGitError } from '../src/utils/errors.js';

async function commitFile(repo: Awaited<ReturnType<typeof createTempRepo>>['repo'], root: string, path: string, message: string) {
  await writeProjectFile(root, path, `${path}-${message}`);
  await repo.add([path]);
  return repo.commit(message);
}

describe('ancestry utilities', () => {
  it('isAncestor returns true along a linear chain', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const a = await commitFile(repo, root, 'a.txt', 'A');
      const b = await commitFile(repo, root, 'b.txt', 'B');
      const c = await commitFile(repo, root, 'c.txt', 'C');

      assert.equal(await isAncestor(repo.objectStore, a, c), true);
      assert.equal(await isAncestor(repo.objectStore, b, c), true);
      assert.equal(await isAncestor(repo.objectStore, c, a), false);
    } finally {
      await cleanup();
    }
  });

  it('isAncestor handles merge commit parent graphs', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const base = await commitFile(repo, root, 'base.txt', 'base');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      const featureTip = await commitFile(repo, root, 'feature.txt', 'feature');

      await new CheckoutEngine(repo).checkout('main');
      const mainTip = await commitFile(repo, root, 'main.txt', 'main');

      const treeHash = await repo.objectStore.writeTree({
        'merged.txt': await repo.objectStore.writeBlob(Buffer.from('merged')),
      });
      const mergeHash = await repo.objectStore.writeCommit({
        tree: treeHash,
        parents: [mainTip, featureTip],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'merge',
        generation: 4,
      });

      assert.equal(await isAncestor(repo.objectStore, base, mergeHash), true);
      assert.equal(await isAncestor(repo.objectStore, featureTip, mergeHash), true);
      assert.equal(await isAncestor(repo.objectStore, mergeHash, base), false);
    } finally {
      await cleanup();
    }
  });

  it('collectAncestors includes all reachable commits', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const a = await commitFile(repo, root, 'a.txt', 'A');
      const b = await commitFile(repo, root, 'b.txt', 'B');

      const ancestors = await collectAncestors(repo.objectStore, b);
      assert.equal(ancestors.has(a), true);
      assert.equal(ancestors.has(b), true);
      assert.equal(ancestors.size, 2);
    } finally {
      await cleanup();
    }
  });

  it('findMergeBase returns the fork point on diverged branches', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const base = await commitFile(repo, root, 'shared.txt', 'shared');

      await repo.createBranch('feature');
      await new CheckoutEngine(repo).checkout('feature');
      const featureTip = await commitFile(repo, root, 'on-feature.txt', 'feature work');

      await new CheckoutEngine(repo).checkout('main');
      const mainTip = await commitFile(repo, root, 'on-main.txt', 'main work');

      const mergeBase = await findMergeBase(repo.objectStore, mainTip, featureTip);
      assert.equal(mergeBase, base);
    } finally {
      await cleanup();
    }
  });

  it('findMergeBase throws when histories are unrelated', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const treeA = await repo.objectStore.writeTree({
        'a.txt': await repo.objectStore.writeBlob(Buffer.from('a')),
      });
      const treeB = await repo.objectStore.writeTree({
        'b.txt': await repo.objectStore.writeBlob(Buffer.from('b')),
      });
      const commitA = await repo.objectStore.writeCommit({
        tree: treeA,
        parents: [],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'orphan a',
      });
      const commitB = await repo.objectStore.writeCommit({
        tree: treeB,
        parents: [],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'orphan b',
      });

      await assert.rejects(
        () => findMergeBase(repo.objectStore, commitA, commitB),
        (error: unknown) => error instanceof MiGitError,
      );
    } finally {
      await cleanup();
    }
  });
});
