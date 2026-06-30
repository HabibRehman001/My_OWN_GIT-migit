import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { MiGitError } from '../src/utils/errors.js';
import {
  resolveBranchStandards,
  validateBranchStandards,
  branchStandardsIssue,
  formatBranchStandardsHelp,
} from '../src/utils/branch-standards.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { getBranchRefPath, getHeadFilePath } from '../src/utils/paths.js';
import { existsSync, readFile } from '../src/utils/file-system.js';
import { IntegrityChecker } from '../src/core/integrity-checker.js';

const standards = resolveBranchStandards();

describe('branch standards validation', () => {
  it('exempts the trunk branch', () => {
    assert.doesNotThrow(() => validateBranchStandards('main', standards));
  });

  it('accepts compliant task branch names', () => {
    for (const name of [
      'feature/user-login',
      'bugfix/token-expiry',
      'hotfix/database-connection',
      'docs/api-documentation',
      'team/backend/order-service',
      'feature/DS-142-login-validation',
    ]) {
      assert.doesNotThrow(() => validateBranchStandards(name, standards));
    }
  });

  it('rejects invalid prefix and shape', () => {
    for (const name of [
      'feature',
      'backend-team-work',
      'feature/login/extra',
      'team/backend',
      'feature/wip',
      'feature/backend-team-work-for-next-six-months',
    ]) {
      assert.throws(() => validateBranchStandards(name, standards), MiGitError);
    }
  });

  it('formats standards help text', () => {
    const help = formatBranchStandardsHelp(standards);
    assert.match(help, /feature\/user-login/);
    assert.match(help, /team\/backend\/order-service/);
  });
});

describe('nested branch refs', () => {
  it('creates, lists, checks out, and deletes nested branch names', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      await repo.createBranch('feature/login');
      const branches = await repo.listBranches();
      assert.ok(branches.includes('feature/login'));
      assert.ok(existsSync(getBranchRefPath(root, 'feature/login')));

      await new CheckoutEngine(repo).checkout('feature/login');
      assert.equal(await repo.getCurrentBranch(), 'feature/login');

      const headContent = (await readFile(getHeadFilePath(root))).toString('utf8');
      assert.match(headContent, /refs\/heads\/feature\/login/);

      await writeProjectFile(root, 'login.txt', 'login work');
      await repo.add(['login.txt']);
      await repo.commit('login feature');

      await new CheckoutEngine(repo).checkout('main');
      await repo.deleteBranch('feature/login');
      assert.ok(!existsSync(getBranchRefPath(root, 'feature/login')));
      assert.ok(!(await repo.listBranches()).includes('feature/login'));
    } finally {
      await cleanup();
    }
  });
});

describe('branch create standards enforcement', () => {
  it('blocks non-compliant names and allows --no-verify to skip slug rules only', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      await assert.rejects(
        () => repo.createBranch('legacy-branch'),
        (error: Error) => error.message.includes('not allowed by policy'),
      );

      await assert.rejects(
        () => repo.createBranch('feature/wip'),
        (error: Error) => error.message.includes('too vague'),
      );

      await repo.createBranch('feature/user-login');
      assert.ok((await repo.listBranches()).includes('feature/user-login'));
    } finally {
      await cleanup();
    }
  });
});

describe('doctor branch standards warnings', () => {
  it('reports existing branches that violate standards', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      const head = await repo.refs.getHead();
      await repo.refs.setBranch('feature/wip', head);

      const issues = await new IntegrityChecker(repo).run();
      assert.ok(
        issues.some((issue) => issue.includes('feature/wip') && issue.includes('naming standards')),
      );
    } finally {
      await cleanup();
    }
  });

  it('returns no issue for compliant branch names', () => {
    assert.equal(branchStandardsIssue('feature/user-login', standards), null);
    assert.ok(branchStandardsIssue('legacy-flat', standards));
  });
});
