import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import { MergeResolveEngine } from '../src/core/merge/merge-resolve.js';
import { loadMergeState } from '../src/core/merge/merge-state.js';
import { hasConflictMarkers } from '../src/core/merge/conflict-markers.js';
import { readFile } from '../src/utils/file-system.js';
import { MiGitError } from '../src/utils/errors.js';

async function setupContentConflictMerge(root: string, repo: Awaited<ReturnType<typeof createTempRepo>>['repo']) {
  await writeProjectFile(root, 'src/auth/token.ts', 'base-token');
  await writeProjectFile(root, 'package-lock.json', 'base-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  await repo.commit('base');

  await repo.createBranch('feature/sample');
  await new CheckoutEngine(repo).checkout('feature/sample');
  await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
  await writeProjectFile(root, 'package-lock.json', 'feature-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  await repo.commit('feature');

  await new CheckoutEngine(repo).checkout('main');
  await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
  await writeProjectFile(root, 'package-lock.json', 'main-lock');
  await repo.add(['src/auth/token.ts', 'package-lock.json']);
  await repo.commit('main');

  await new MergeEngine(repo).merge('feature/sample');
}

describe('conflict markers', () => {
  it('detects migit diff3 marker lines', () => {
    const marked = [
      '<<<<<<< current:main',
      'ours',
      '||||||| base',
      'base',
      '=======',
      'theirs',
      '>>>>>>> incoming:feature',
    ].join('\n');

    assert.equal(hasConflictMarkers(marked), true);
    assert.equal(hasConflictMarkers('const value = "clean";\n'), false);
  });
});

describe('merge resolve', () => {
  it('marks a conflict resolved after markers are removed', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);

      await writeProjectFile(root, 'src/auth/token.ts', 'resolved-token');

      const result = await new MergeResolveEngine(repo).resolve(['src/auth/token.ts']);
      assert.equal(result.length, 1);
      assert.equal(result[0]?.path, 'src/auth/token.ts');
      assert.equal(result[0]?.remainingConflicts, 1);

      const mergeState = await loadMergeState(root);
      const token = mergeState?.conflicts.find((entry) => entry.path === 'src/auth/token.ts');
      assert.equal(token?.resolved, true);

      const lock = mergeState?.conflicts.find((entry) => entry.path === 'package-lock.json');
      assert.equal(lock?.resolved, false);

      const index = await repo.indexStore.load();
      const tokenEntry = index.find((entry) => entry.path === 'src/auth/token.ts');
      assert.ok(tokenEntry);
      assert.equal(
        (await repo.objectStore.readBlob(tokenEntry.hash)).toString('utf8'),
        'resolved-token',
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects resolve when conflict markers remain', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);

      const marked = (await readFile(join(root, 'src/auth/token.ts'))).toString('utf8');
      assert.equal(hasConflictMarkers(marked), true);

      await assert.rejects(
        () => new MergeResolveEngine(repo).resolve(['src/auth/token.ts']),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('still contains conflict markers'),
      );

      const mergeState = await loadMergeState(root);
      const token = mergeState?.conflicts.find((entry) => entry.path === 'src/auth/token.ts');
      assert.equal(token?.resolved, false);
    } finally {
      await cleanup();
    }
  });

  it('does not mark conflicts resolved when migit add is used instead', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);

      await writeProjectFile(root, 'src/auth/token.ts', 'resolved-via-add');
      await repo.add(['src/auth/token.ts']);

      const beforeResolve = await loadMergeState(root);
      assert.equal(
        beforeResolve?.conflicts.find((entry) => entry.path === 'src/auth/token.ts')?.resolved,
        false,
      );

      const result = await new MergeResolveEngine(repo).resolve(['src/auth/token.ts']);
      assert.equal(result[0]?.remainingConflicts, 1);

      const afterResolve = await loadMergeState(root);
      assert.equal(
        afterResolve?.conflicts.find((entry) => entry.path === 'src/auth/token.ts')?.resolved,
        true,
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects resolve when no merge is in progress', async () => {
    const { repo, cleanup } = await createTempRepo();
    try {
      await assert.rejects(
        () => new MergeResolveEngine(repo).resolve(['src/auth/token.ts']),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('no merge is in progress'),
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects resolve for paths that are not conflicted', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);

      await assert.rejects(
        () => new MergeResolveEngine(repo).resolve(['README.md']),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('not a listed merge conflict'),
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects resolve when the working tree file is missing', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await setupContentConflictMerge(root, repo);
      await unlink(join(root, 'src/auth/token.ts'));

      await assert.rejects(
        () => new MergeResolveEngine(repo).resolve(['src/auth/token.ts']),
        (error: unknown) =>
          error instanceof MiGitError && error.message.includes('does not exist in the working tree'),
      );
    } finally {
      await cleanup();
    }
  });
});
