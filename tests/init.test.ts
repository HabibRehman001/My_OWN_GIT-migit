import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { listCommitFiles } from '../src/core/commit-files.js';
import { MiGitError } from '../src/utils/errors.js';

describe('migit init on existing repository', () => {
  it('rejects re-init when commit history exists without --force', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'file.txt', 'content');
      await repo.add(['file.txt']);
      await repo.commit('initial');

      await assert.rejects(
        () => repo.init(),
        (error: unknown) => {
          assert.ok(error instanceof MiGitError);
          assert.match(String(error), /init --force/);
          return true;
        },
      );
    } finally {
      await cleanup();
    }
  });

  it('clears history with --force so the next commit lists staged files', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'file.txt', 'content');
      await repo.add(['file.txt']);
      await repo.commit('initial');

      const result = await repo.init({ force: true });
      assert.equal(result, 'reinitialized');
      assert.equal(await repo.refs.getHead(), null);

      await repo.add(['file.txt']);
      const files = await listCommitFiles(repo);
      assert.ok(files.some((file) => file.path === 'file.txt' && file.changeType === 'added'));
    } finally {
      await cleanup();
    }
  });
});
