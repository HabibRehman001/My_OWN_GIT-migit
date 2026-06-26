import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { formatCommitFileChange, listCommitFiles } from '../src/core/commit-files.js';

describe('commit file listing', () => {
  it('lists all index files on the first commit', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'a.txt', 'a');
      await writeProjectFile(root, 'b.txt', 'b');
      await repo.add(['.']);

      const files = await listCommitFiles(repo);
      assert.ok(files.some((file) => file.path === 'a.txt' && file.changeType === 'added'));
      assert.ok(files.some((file) => file.path === 'b.txt' && file.changeType === 'added'));
    } finally {
      await cleanup();
    }
  });

  it('reports modified and deleted files after HEAD exists', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'keep.txt', 'v1');
      await writeProjectFile(root, 'gone.txt', 'bye');
      await repo.add(['.']);
      await repo.commit('initial');

      await writeProjectFile(root, 'keep.txt', 'v2');
      const { unlink } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await unlink(join(root, 'gone.txt'));
      await repo.add(['.']);

      const files = await listCommitFiles(repo);
      assert.deepEqual(
        files.map((file) => [file.path, file.changeType]),
        [
          ['gone.txt', 'deleted'],
          ['keep.txt', 'modified'],
        ],
      );
    } finally {
      await cleanup();
    }
  });

  it('formats file changes for commit output', () => {
    assert.equal(formatCommitFileChange({ path: 'src/a.ts', changeType: 'added' }), '  new file: src/a.ts');
    assert.equal(formatCommitFileChange({ path: 'README.md', changeType: 'modified' }), '  modified: README.md');
    assert.equal(formatCommitFileChange({ path: 'old.txt', changeType: 'deleted' }), '  deleted: old.txt');
  });
});
