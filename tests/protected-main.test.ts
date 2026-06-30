import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { MiGitError } from '../src/utils/errors.js';
import {
  formatProtectedBranchCommitError,
  suggestWorkingBranchName,
} from '../src/utils/branch-policy.js';
import { runWithHistory } from '../src/history/run-with-history.js';
import { setHistorySuccessExtras } from '../src/history/history-context.js';
import { getHistoryPath } from '../src/utils/paths.js';

describe('protected main branch', () => {
  it('suggests a working branch from staged file paths', () => {
    assert.equal(suggestWorkingBranchName(['src/app.ts']), 'feature/change-app');
  });

  it('formats the protected-branch error with branch creation commands', () => {
    const message = formatProtectedBranchCommitError('main', ['src/app.ts']);
    assert.match(message, /Direct commits to protected branch "main" are not allowed/);
    assert.match(message, /Create a working branch:/);
    assert.match(message, /migit branch feature\/change-app/);
    assert.match(message, /migit checkout feature\/change-app/);
  });

  it('blocks direct commits on main with working-branch guidance', async () => {
    const { root, repo, cleanup } = await createTempRepo({ strictPolicy: true });
    try {
      await writeProjectFile(root, 'src/app.ts', 'v1\n');
      await repo.add(['src/app.ts']);
      await repo.commit('initial');

      await writeProjectFile(root, 'src/app.ts', 'v1\nchange\n');
      await repo.add(['src/app.ts']);

      await assert.rejects(
        () => repo.commit('Change app'),
        (error: unknown) => {
          assert.ok(error instanceof MiGitError);
          assert.match(error.message, /Direct commits to protected branch "main"/);
          assert.match(error.message, /migit branch feature\/change-app/);
          assert.match(error.message, /migit checkout feature\/change-app/);
          return true;
        },
      );
    } finally {
      await cleanup();
    }
  });

  it('allows maintainer override with --override-policy', async () => {
    const { root, repo, cleanup } = await createTempRepo({ strictPolicy: true });
    try {
      await writeProjectFile(root, 'src/app.ts', 'v1\n');
      await repo.add(['src/app.ts']);
      await repo.commit('initial');

      await writeProjectFile(root, 'src/app.ts', 'v1\nchange\n');
      await repo.add(['src/app.ts']);

      const hash = await repo.commit('Emergency fix', { overridePolicy: true });
      assert.ok(hash);
      assert.equal((await readFile(`${root}/src/app.ts`, 'utf8')).includes('change'), true);
    } finally {
      await cleanup();
    }
  });

  it('records policy override in history on successful commit', async () => {
    const { root, repo, cleanup } = await createTempRepo({ strictPolicy: true });
    try {
      await writeProjectFile(root, 'src/app.ts', 'v1\n');
      await repo.add(['src/app.ts']);
      await repo.commit('initial');

      await writeProjectFile(root, 'src/app.ts', 'v1\nchange\n');
      await repo.add(['src/app.ts']);

      const previousCwd = process.cwd();
      process.chdir(root);
      try {
        await runWithHistory(
          'commit',
          ['commit', '-m', 'Emergency fix', '--override-policy'],
          async () => {
            setHistorySuccessExtras({ policyOverride: true, branch: 'main' });
            await repo.commit('Emergency fix', { overridePolicy: true });
          },
        );
      } finally {
        process.chdir(previousCwd);
      }

      const lines = (await readFile(getHistoryPath(root), 'utf8')).trim().split('\n');
      const last = JSON.parse(lines[lines.length - 1]);
      assert.equal(last.command, 'commit');
      assert.equal(last.policyOverride, true);
      assert.equal(last.branch, 'main');
      assert.equal(last.status, 'success');
    } finally {
      await cleanup();
    }
  });
});
