import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectStore } from '../src/core/object-store.js';
import {
  collectAllPaths,
  loadMergeTrees,
  loadTree,
  mergeTrees,
  summarizeTreeMerge,
} from '../src/core/merge/tree-merge.js';

async function storeTextBlobs(
  store: ObjectStore,
  entries: Record<string, string>,
): Promise<Map<string, string>> {
  const tree = new Map<string, string>();
  for (const [path, content] of Object.entries(entries)) {
    tree.set(path, await store.writeBlob(Buffer.from(content, 'utf8')));
  }
  return tree;
}

async function writeCommitFromTree(
  store: ObjectStore,
  tree: Map<string, string>,
  parents: string[] = [],
): Promise<string> {
  const treeHash = await store.writeTree(Object.fromEntries(tree));
  return store.writeCommit({
    tree: treeHash,
    parents,
    author: 'test <test@example.com>',
    timestamp: Date.now(),
    message: 'test commit',
    generation: parents.length === 0 ? 1 : 2,
  });
}

describe('tree merge engine', () => {
  it('classifies unchanged, ours-only, and theirs-only paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-merge-'));
    try {
      const store = new ObjectStore(root);
      const base = await storeTextBlobs(store, {
        'unchanged.txt': 'same',
        'shared.txt': 'base',
      });
      const ours = await storeTextBlobs(store, {
        'unchanged.txt': 'same',
        'main-only.txt': 'main',
        'shared.txt': 'base',
      });
      const theirs = await storeTextBlobs(store, {
        'unchanged.txt': 'same',
        'feature-only.txt': 'feature',
        'shared.txt': 'base',
      });

      const result = await mergeTrees(store, base, ours, theirs);
      const summary = summarizeTreeMerge(result);

      assert.equal(summary.unchanged, 2);
      assert.equal(summary.changedOnlyOurs, 1);
      assert.equal(summary.changedOnlyTheirs, 1);
      assert.equal(summary.changedBoth, 0);
      assert.equal(result.conflicts.length, 0);
      assert.equal(result.mergedFiles.get('main-only.txt'), ours.get('main-only.txt'));
      assert.equal(result.mergedFiles.get('feature-only.txt'), theirs.get('feature-only.txt'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves same-change paths into mergedFiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-merge-same-'));
    try {
      const store = new ObjectStore(root);
      const sharedHash = await store.writeBlob(Buffer.from('v2', 'utf8'));
      const base = await storeTextBlobs(store, { 'shared.txt': 'v1' });
      const ours = new Map([['shared.txt', sharedHash]]);
      const theirs = new Map([['shared.txt', sharedHash]]);

      const result = await mergeTrees(store, base, ours, theirs);
      assert.equal(result.paths[0]?.status, 'same-change');
      assert.equal(result.mergedFiles.get('shared.txt'), sharedHash);
      assert.equal(result.conflicts.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('auto-merges dual-change text files with non-overlapping edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-merge-auto-'));
    try {
      const store = new ObjectStore(root);
      const base = await storeTextBlobs(store, {
        'file.txt': 'line1\nline2\nline3',
      });
      const ours = await storeTextBlobs(store, {
        'file.txt': 'line1\nline2-main\nline3',
      });
      const theirs = await storeTextBlobs(store, {
        'file.txt': 'line1\nline2\nline3-feature',
      });

      const result = await mergeTrees(store, base, ours, theirs);
      assert.equal(result.conflicts.length, 0);
      assert.equal(result.paths[0]?.status, 'auto-merged');

      const mergedHash = result.mergedFiles.get('file.txt');
      assert.ok(mergedHash);
      const merged = (await store.readBlob(mergedHash!)).toString('utf8');
      assert.equal(merged, 'line1\nline2-main\nline3-feature');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects content, add-add, and modify-delete conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-merge-conflicts-'));
    try {
      const store = new ObjectStore(root);
      const base = await storeTextBlobs(store, {
        'src/auth/token.ts': 'base-token',
        'package-lock.json': 'base-lock',
        'src/config.ts': 'base-config',
      });
      const ours = await storeTextBlobs(store, {
        'src/auth/token.ts': 'main-token',
        'package-lock.json': 'main-lock',
      });
      const theirs = await storeTextBlobs(store, {
        'src/auth/token.ts': 'feature-token',
        'package-lock.json': 'feature-lock',
        'src/config.ts': 'feature-config',
        'brand-new.txt': 'feature-new',
      });

      ours.set('brand-new.txt', (await store.writeBlob(Buffer.from('main-new', 'utf8'))));

      const result = await mergeTrees(store, base, ours, theirs);
      assert.equal(result.conflicts.length, 4);

      const byPath = new Map(result.conflicts.map((entry) => [entry.path, entry.conflictType]));
      assert.equal(byPath.get('src/auth/token.ts'), 'content');
      assert.equal(byPath.get('package-lock.json'), 'content');
      assert.equal(byPath.get('src/config.ts'), 'modify-delete');
      assert.equal(byPath.get('brand-new.txt'), 'add-add');
      assert.equal(result.mergedFiles.has('src/auth/token.ts'), true);
      assert.equal(result.mergedFiles.has('package-lock.json'), true);
      assert.equal(result.mergedFiles.has('src/config.ts'), false);
      assert.equal(result.mergedFiles.has('brand-new.txt'), false);

      const tokenPath = result.paths.find((entry) => entry.path === 'src/auth/token.ts');
      assert.equal(tokenPath?.status, 'conflict');
      assert.ok(tokenPath?.resultHash);
      const markedToken = (await store.readBlob(tokenPath!.resultHash!)).toString('utf8');
      assert.match(markedToken, /^<<<<<<< current:main/);
      assert.ok(markedToken.includes('||||||| base'));
      assert.ok(markedToken.includes('======='));
      assert.match(markedToken, />>>>>>> incoming:branch$/m);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads committed trees and unions all paths before classifying', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-merge-load-'));
    try {
      const store = new ObjectStore(root);
      const baseTree = await storeTextBlobs(store, { 'shared.txt': 'base' });
      const baseCommit = await writeCommitFromTree(store, baseTree);

      const ourTree = new Map(baseTree);
      ourTree.set('main.txt', await store.writeBlob(Buffer.from('main')));
      const ourCommit = await writeCommitFromTree(store, ourTree, [baseCommit]);

      const theirTree = new Map(baseTree);
      theirTree.set('feature.txt', await store.writeBlob(Buffer.from('feature')));
      const theirCommit = await writeCommitFromTree(store, theirTree, [baseCommit]);

      const loaded = await loadMergeTrees(store, baseCommit, ourCommit, theirCommit);
      assert.deepEqual(
        collectAllPaths(loaded.baseTree, loaded.ourTree, loaded.theirTree),
        ['feature.txt', 'main.txt', 'shared.txt'],
      );

      const directOur = await loadTree(store, ourCommit);
      assert.equal(directOur.get('main.txt'), ourTree.get('main.txt'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags binary blobs as binary conflicts when content is loaded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-tree-merge-binary-'));
    try {
      const store = new ObjectStore(root);
      const baseHash = await store.writeBlob(Buffer.from('base'));
      const ourHash = await store.writeBlob(Buffer.from([0x00, 0x01, 0x02]));
      const theirHash = await store.writeBlob(Buffer.from([0x00, 0x03, 0x04]));

      const base = new Map([['image.bin', baseHash]]);
      const ours = new Map([['image.bin', ourHash]]);
      const theirs = new Map([['image.bin', theirHash]]);

      const result = await mergeTrees(store, base, ours, theirs);
      assert.equal(result.conflicts.length, 1);
      assert.equal(result.conflicts[0]?.conflictType, 'binary');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
