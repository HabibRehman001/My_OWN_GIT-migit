import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeGeneration,
  getPrimaryParent,
  normalizeCommit,
  serializeCommit,
} from '../src/core/commit-normalize.js';
import { ObjectStore } from '../src/core/object-store.js';
import { compress } from '../src/utils/compression.js';
import { writeFile } from '../src/utils/file-system.js';

describe('commit-normalize', () => {
  it('migrates legacy parent field to parents array', () => {
    const legacy = {
      tree: 'a'.repeat(64),
      parent: 'b'.repeat(64),
      author: 'test <test@example.com>',
      timestamp: 1,
      message: 'legacy',
    };

    assert.deepEqual(normalizeCommit(legacy).parents, [legacy.parent]);
  });

  it('treats missing parent as empty parents for root commits', () => {
    const root = {
      tree: 'a'.repeat(64),
      author: 'test <test@example.com>',
      timestamp: 1,
      message: 'root',
    };

    assert.deepEqual(normalizeCommit(root).parents, []);
  });

  it('preserves merge commits with two parents', () => {
    const merge = {
      tree: 'a'.repeat(64),
      parents: ['b'.repeat(64), 'c'.repeat(64)],
      author: 'test <test@example.com>',
      timestamp: 1,
      message: 'Merge branch feature/login into main',
    };

    assert.equal(normalizeCommit(merge).parents.length, 2);
    assert.equal(getPrimaryParent(normalizeCommit(merge)), merge.parents[0]);
  });

  it('serializeCommit never writes legacy parent field', () => {
    const serialized = serializeCommit({
      tree: 'a'.repeat(64),
      parents: ['b'.repeat(64)],
      author: 'test <test@example.com>',
      timestamp: 1,
      message: 'normal',
      generation: 1,
    });

    assert.deepEqual(serialized.parents, ['b'.repeat(64)]);
    assert.equal('parent' in serialized, false);
    assert.equal(serialized.generation, 1);
  });

  it('computeGeneration uses max parent generation plus one', () => {
    assert.equal(computeGeneration([], []), 1);
    assert.equal(
      computeGeneration(['a'.repeat(64)], [{ tree: 't', parents: [], author: 'x', timestamp: 0, message: 'p', generation: 3 }]),
      4,
    );
    assert.equal(
      computeGeneration(
        ['a'.repeat(64), 'b'.repeat(64)],
        [
          { tree: 't', parents: [], author: 'x', timestamp: 0, message: 'p1', generation: 2 },
          { tree: 't', parents: [], author: 'x', timestamp: 0, message: 'p2', generation: 5 },
        ],
      ),
      6,
    );
  });
});

describe('legacy commit objects on disk', () => {
  it('readCommit normalizes old parent JSON from the object store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-legacy-commit-'));
    try {
      const store = new ObjectStore(root);
      const treeHash = await store.writeTree({ 'file.txt': await store.writeBlob(Buffer.from('x')) });
      const legacyPayload = Buffer.from(
        JSON.stringify({
          tree: treeHash,
          parent: 'd'.repeat(64),
          author: 'test <test@example.com>',
          timestamp: Date.now(),
          message: 'old format',
        }),
      );
      const serialized = Buffer.concat([
        Buffer.from(`commit ${legacyPayload.length}`),
        Buffer.from('\0'),
        legacyPayload,
      ]);
      const hash = 'e'.repeat(64);
      await writeFile(store.objectPathForHash(hash), compress(serialized));

      const commit = await store.readCommit(hash);
      assert.deepEqual(commit.parents, ['d'.repeat(64)]);
      assert.equal('parent' in commit, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writeCommit stores parents array for merge commits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-merge-commit-'));
    try {
      const store = new ObjectStore(root);
      const treeHash = await store.writeTree({ 'merged.txt': await store.writeBlob(Buffer.from('merged')) });
      const mainHead = '1'.repeat(64);
      const featureHead = '2'.repeat(64);
      const commitHash = await store.writeCommit({
        tree: treeHash,
        parents: [mainHead, featureHead],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'Merge branch feature/login into main',
        generation: 4,
      });

      const commit = await store.readCommit(commitHash);
      assert.deepEqual(commit.parents, [mainHead, featureHead]);
      assert.equal(commit.generation, 4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
