import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findScopedDeletions, isPathInAddScope } from '../src/utils/add-scope.js';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';

describe('add-scope', () => {
  it('add src/ does not include paths outside src', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-scope-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await mkdir(join(root, 'lib'), { recursive: true });
      await writeFile(join(root, 'src', 'a.ts'), 'a');
      await writeFile(join(root, 'lib', 'b.ts'), 'b');

      assert.equal(await isPathInAddScope('src/a.ts', ['src'], root), true);
      assert.equal(await isPathInAddScope('lib/b.ts', ['src'], root), false);
      assert.equal(await isPathInAddScope('lib/b.ts', ['.'], root), true);

      const deletions = await findScopedDeletions(
        ['src/a.ts', 'lib/b.ts'],
        new Set(['lib/b.ts']),
        ['src'],
        root,
      );
      assert.deepEqual(deletions, ['src/a.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scoped deletion removes only files missing within add scope', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/keep.ts', '1');
      await writeProjectFile(root, 'src/remove.ts', '2');
      await writeProjectFile(root, 'other.txt', '3');
      await repo.add(['.']);
      await repo.commit('initial');

      await unlink(join(root, 'src/remove.ts'));
      await repo.add(['src']);

      const index = await repo.indexStore.load();
      const paths = index.map((entry) => entry.path).sort();
      assert.deepEqual(paths, ['.migitignore', 'other.txt', 'src/keep.ts']);
    } finally {
      await cleanup();
    }
  });
});
