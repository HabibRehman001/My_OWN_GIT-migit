import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ObjectStore,
  hashSerializedObject,
  parseObject,
} from '../src/core/object-store.js';
import { compress, decompress } from '../src/utils/compression.js';
import { readFile, writeFile } from '../src/utils/file-system.js';

describe('object-store', () => {
  it('writeBlob hash matches parseObject recomputation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-obj-'));
    try {
      const store = new ObjectStore(root);
      const content = Buffer.from('hello migit');
      const hash = await store.writeBlob(content);
      const roundTrip = await store.readBlob(hash);
      assert.equal(roundTrip.toString('utf8'), 'hello migit');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writeTree stores tree header not blob header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-'));
    try {
      const store = new ObjectStore(root);
      const blobHash = await store.writeBlob(Buffer.from('file bytes'));
      const treeHash = await store.writeTree({ 'a.txt': blobHash });

      const objectPath = store.objectPathForHash(treeHash);
      const uncompressed = decompress(await readFile(objectPath));
      const parsed = parseObject(uncompressed);
      assert.ok(!('error' in parsed));
      assert.equal(parsed.type, 'tree');
      assert.match(uncompressed.subarray(0, 20).toString('utf8'), /^tree \d+\0/);

      const roundTrip = await store.readTree(treeHash);
      assert.equal(roundTrip.get('a.txt'), blobHash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('readTree rejects blob objects masquerading as trees', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-reject-'));
    try {
      const store = new ObjectStore(root);
      const blobHash = await store.writeBlob(
        Buffer.from(JSON.stringify({ 'a.txt': 'deadbeef' })),
      );
      await assert.rejects(
        () => store.readTree(blobHash),
        (error: Error) => error.message.includes('not a tree'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parseObject accepts blob, tree, and commit headers', () => {
    for (const type of ['blob', 'tree', 'commit'] as const) {
      const payload = Buffer.from('payload');
      const serialized = Buffer.concat([
        Buffer.from(`${type} ${payload.length}`),
        Buffer.from('\0'),
        payload,
      ]);
      const parsed = parseObject(serialized);
      assert.ok(!('error' in parsed));
      assert.equal(parsed.type, type);
    }
  });

  it('parseObject rejects malformed headers and size mismatches', () => {
    const badHeader = Buffer.from('not-a-blob 5\0hello');
    assert.ok('error' in parseObject(badHeader));

    const sizeMismatch = Buffer.from('blob 10\0short');
    assert.ok('error' in parseObject(sizeMismatch));
  });

  it('verifyStorage detects hash/path mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-bad-obj-'));
    try {
      const store = new ObjectStore(root);
      const hash = await store.writeBlob(Buffer.from('valid'));

      const valid = await store.readBlob(hash);
      const serialized = Buffer.concat([
        Buffer.from(`blob ${valid.length}`),
        Buffer.from('\0'),
        valid,
      ]);
      const wrongHash = 'a'.repeat(64);
      const wrongPath = `${root}/.migit/objects/${wrongHash.slice(0, 2)}/${wrongHash.slice(2)}`;
      await writeFile(wrongPath, compress(serialized));

      const result = await store.verifyStorage();
      assert.ok(result.issues.some((issue) => issue.includes('hash mismatch')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('commit round-trip preserves tree reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-commit-'));
    try {
      const store = new ObjectStore(root);
      const blobHash = await store.writeBlob(Buffer.from('abc'));
      const treeHash = await store.writeTree({ 'a.txt': blobHash });
      const commitHash = await store.writeCommit({
        tree: treeHash,
        parents: [],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'test',
      });
      const commit = await store.readCommit(commitHash);
      assert.equal(commit.tree, treeHash);
      assert.equal(commit.message, 'test');
      assert.deepEqual(commit.parents, []);

      const verification = await store.verifyStorage();
      const treeRecord = verification.objects.get(treeHash);
      assert.ok(treeRecord);
      assert.equal(treeRecord.type, 'tree');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('hashSerializedObject', () => {
  it('is deterministic for identical serialized bytes', () => {
    const object = Buffer.from('blob 5\0hello');
    assert.equal(hashSerializedObject(object), hashSerializedObject(object));
  });
});
