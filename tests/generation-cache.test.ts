import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ObjectStore } from '../src/core/object-store.js';
import { GenerationResolver } from '../src/core/merge/generation.js';
import { CommitGenerationCache } from '../src/core/merge/commit-generation-cache.js';
import { getCommitGenerationsCachePath } from '../src/utils/paths.js';
import { existsSync, readFile } from '../src/utils/file-system.js';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';

describe('commit generation resolution', () => {
  it('assigns generation 1 to root commits and increments along a chain', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'a.txt', 'a');
      await repo.add(['a.txt']);
      const rootCommit = await repo.commit('root');

      const resolver = new GenerationResolver(repo.objectStore, root);
      await resolver.init();

      assert.equal(await resolver.getGeneration(rootCommit), 1);

      await writeProjectFile(root, 'b.txt', 'b');
      await repo.add(['b.txt']);
      const second = await repo.commit('second');
      assert.equal(await resolver.getGeneration(second), 2);
    } finally {
      await cleanup();
    }
  });

  it('derives generation for legacy commits without rewriting objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-gen-legacy-'));
    try {
      const store = new ObjectStore(root);
      const blob = await store.writeBlob(Buffer.from('x'));
      const tree = await store.writeTree({ 'f.txt': blob });

      const rootHash = await store.writeCommit({
        tree,
        parents: [],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'legacy root',
      });

      const childHash = await store.writeCommit({
        tree,
        parents: [rootHash],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'legacy child',
      });

      const resolver = new GenerationResolver(store, root);
      await resolver.init();
      assert.equal(await resolver.getGeneration(rootHash), 1);
      assert.equal(await resolver.getGeneration(childHash), 2);

      const rootCommit = await store.readCommit(rootHash);
      assert.equal(rootCommit.generation, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('optional cache can be deleted safely and is rebuilt on demand', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-gen-cache-'));
    try {
      const store = new ObjectStore(root);
      const blob = await store.writeBlob(Buffer.from('cached'));
      const tree = await store.writeTree({ 'cache-me.txt': blob });

      const rootHash = await store.writeCommit({
        tree,
        parents: [],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'legacy root',
      });
      const commitHash = await store.writeCommit({
        tree,
        parents: [rootHash],
        author: 'test <test@example.com>',
        timestamp: Date.now(),
        message: 'legacy child',
      });

      const resolver = new GenerationResolver(store, root);
      await resolver.init();
      assert.equal(await resolver.getGeneration(commitHash), 2);
      await resolver.flush();

      const cachePath = getCommitGenerationsCachePath(root);
      assert.equal(existsSync(cachePath), true);

      await rm(cachePath, { force: true });
      assert.equal(existsSync(cachePath), false);

      const cache = new CommitGenerationCache(root);
      await cache.load();
      assert.equal(cache.get(commitHash), undefined);

      const rebuilt = new GenerationResolver(store, root);
      await rebuilt.init();
      assert.equal(await rebuilt.getGeneration(commitHash), 2);
      await rebuilt.flush();
      assert.equal(existsSync(cachePath), true);

      const raw = JSON.parse((await readFile(cachePath)).toString('utf8')) as Record<string, number>;
      assert.equal(raw[commitHash], 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
