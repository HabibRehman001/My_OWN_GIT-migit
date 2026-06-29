import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { writeFile } from '../src/utils/file-system.js';
import { getIndexPath } from '../src/utils/paths.js';

describe('integrity checker / doctor', () => {
  it('passes on a healthy repository', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'ok.txt', 'fine');
      await repo.add(['ok.txt']);
      await repo.commit('healthy');

      const issues = await repo.checkIntegrity();
      assert.deepEqual(issues, []);
    } finally {
      await cleanup();
    }
  });

  it('detects index entries pointing at missing blobs', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'ok.txt', 'fine');
      await repo.add(['ok.txt']);
      await repo.commit('healthy');

      const fakeHash = 'b'.repeat(64);
      await writeFile(
        getIndexPath(root),
        Buffer.from(
          JSON.stringify([{ path: 'missing-on-disk.txt', hash: fakeHash, mode: '100644' }], null, 2),
          'utf8',
        ),
      );

      const issues = await repo.checkIntegrity();
      assert.ok(issues.some((issue) => issue.includes('missing-on-disk.txt')));
      assert.ok(issues.some((issue) => issue.includes('missing object')));
    } finally {
      await cleanup();
    }
  });

  it('detects malformed commit tree references', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const missingTree = 'c'.repeat(64);
      const commitHash = await repo.objectStore.writeCommit({
        tree: missingTree,
        parents: [],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'bad tree',
      });
      await repo.refs.setHead(commitHash);

      const issues = await repo.checkIntegrity();
      assert.ok(
        issues.some(
          (issue) => issue.includes('missing tree') || issue.includes(missingTree),
        ),
      );
    } finally {
      await cleanup();
    }
  });

  it('detects merge commits with a missing parent object', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'ok.txt', 'fine');
      await repo.add(['ok.txt']);
      const mainTip = await repo.commit('healthy');

      const treeHash = await repo.objectStore.writeTree({
        'ok.txt': (await repo.indexStore.load())[0]!.hash,
      });
      const missingParent = 'f'.repeat(64);
      const mergeHash = await repo.objectStore.writeCommit({
        tree: treeHash,
        parents: [mainTip, missingParent],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'bad merge',
      });
      await repo.refs.setHead(mergeHash);

      const issues = await repo.checkIntegrity();
      assert.ok(
        issues.some((issue) => issue.includes(`missing parent object ${missingParent}`)),
      );
    } finally {
      await cleanup();
    }
  });
});
