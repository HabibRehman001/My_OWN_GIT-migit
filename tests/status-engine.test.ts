import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { StatusEngine } from '../src/core/status-engine.js';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

describe('status-engine three-way status', () => {
  it('reports staged added before first commit', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'new.txt', 'content');
      await repo.add(['new.txt']);

      const status = await new StatusEngine(repo).getStatus();
      const entry = status.find((item) => item.path === 'new.txt');
      assert.ok(entry);
      assert.equal(entry.staged, 'added');
      assert.equal(entry.working, null);
    } finally {
      await cleanup();
    }
  });

  it('reports working modified when disk changes after staging', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'file.txt', 'v1');
      await repo.add(['file.txt']);
      await repo.commit('initial');

      await writeProjectFile(root, 'file.txt', 'v2');
      const status = await new StatusEngine(repo).getStatus();
      const entry = status.find((item) => item.path === 'file.txt');
      assert.ok(entry);
      assert.equal(entry.staged, null);
      assert.equal(entry.working, 'modified');
    } finally {
      await cleanup();
    }
  });

  it('reports untracked files not in index', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'tracked.txt', 'x');
      await repo.add(['tracked.txt']);
      await repo.commit('initial');

      await writeProjectFile(root, 'orphan.txt', 'y');
      const status = await new StatusEngine(repo).getStatus();
      const entry = status.find((item) => item.path === 'orphan.txt');
      assert.ok(entry);
      assert.equal(entry.staged, null);
      assert.equal(entry.working, 'untracked');
    } finally {
      await cleanup();
    }
  });

  it('reports staged deleted when file removed from disk and re-added in scope', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'gone.txt', 'bye');
      await repo.add(['gone.txt']);
      await repo.commit('initial');

      await unlink(join(root, 'gone.txt'));
      await repo.add(['.']);

      const status = await new StatusEngine(repo).getStatus();
      const entry = status.find((item) => item.path === 'gone.txt');
      assert.ok(entry);
      assert.equal(entry.staged, 'deleted');
    } finally {
      await cleanup();
    }
  });
});
