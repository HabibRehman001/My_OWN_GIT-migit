import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { validateBranchName } from '../src/utils/branch-name.js';
import { MiGitError } from '../src/utils/errors.js';
import { getHeadFilePath } from '../src/utils/paths.js';
import { readFile } from '../src/utils/file-system.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';

describe('branch name validation', () => {
  it('rejects invalid names', () => {
    for (const name of ['../main', 'feature/auth?', 'feature auth', '', 'main.lock']) {
      assert.throws(() => validateBranchName(name), MiGitError);
    }
  });

  it('accepts valid names', () => {
    for (const name of ['main', 'feature/auth', 'bugfix-123']) {
      assert.doesNotThrow(() => validateBranchName(name));
    }
  });
});

describe('branch repository rules', () => {
  it('rejects duplicate branch creation', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      await assert.rejects(
        () => repo.createBranch('main'),
        (error: Error) => error.message.includes('already exists'),
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects deleting current branch and missing branches', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      await assert.rejects(
        () => repo.deleteBranch('main'),
        (error: Error) => error.message.includes('currently checked out'),
      );
      await assert.rejects(
        () => repo.deleteBranch('missing'),
        (error: Error) => error.message.includes('does not exist'),
      );
    } finally {
      await cleanup();
    }
  });
});

describe('checkout branch switching', () => {
  it('updates HEAD only and restores target branch files', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'main.txt', 'on main');
      await repo.add(['main.txt']);
      await repo.commit('main commit');
      const mainHead = await repo.refs.getHead();

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'feature.txt', 'on feature');
      await repo.add(['feature.txt']);
      await repo.commit('feature commit');
      const featureHead = await repo.refs.readBranch('feature/sample');

      await new CheckoutEngine(repo).checkout('feature/sample');
      assert.equal(await repo.getCurrentBranch(), 'feature/sample');
      assert.equal(await repo.refs.readBranch('main'), mainHead);
      assert.equal(await repo.refs.readBranch('feature/sample'), featureHead);

      const headContent = (await readFile(getHeadFilePath(root))).toString('utf8');
      assert.match(headContent, /refs\/heads\/feature/);
    } finally {
      await cleanup();
    }
  });
});
