import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { Repository } from '../src/core/repository.js';
import { MiGitError } from '../src/utils/errors.js';
import {
  matchBranchPattern,
  validateBranchPolicy,
  assertDirectCommitAllowed,
  collectCommitPolicyWarnings,
  collectMergePolicyWarnings,
} from '../src/utils/branch-policy.js';
import { createDefaultPolicy, PolicyStore } from '../src/core/policy-store.js';
import { getPolicyPath } from '../src/utils/paths.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import { MergeEngine } from '../src/core/merge/merge-engine.js';
import { IntegrityChecker } from '../src/core/integrity-checker.js';
import { computeMergePreview } from '../src/core/merge/merge-preview.js';
import { atomicWrite } from '../src/utils/atomic-write.js';

const policy = createDefaultPolicy();

describe('branch policy patterns', () => {
  it('matches allowed glob patterns', () => {
    assert.ok(matchBranchPattern('feature/login', 'feature/*'));
    assert.ok(matchBranchPattern('bugfix/token-expiry', 'bugfix/*'));
    assert.ok(matchBranchPattern('team/backend', 'team/*'));
    assert.ok(!matchBranchPattern('legacy-flat', 'feature/*'));
    assert.ok(matchBranchPattern('main', 'main'));
  });

  it('exempts the default branch from pattern rules', () => {
    assert.doesNotThrow(() => validateBranchPolicy('main', policy));
  });

  it('rejects disallowed branch names on create', () => {
    assert.throws(() => validateBranchPolicy('legacy-flat', policy), MiGitError);
  });
});

describe('policy.json on init', () => {
  it('writes the default policy file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-policy-init-'));
    try {
      const repo = Repository.at(root);
      await repo.init();

      const raw = await readFile(getPolicyPath(root), 'utf8');
      const saved = JSON.parse(raw);
      assert.equal(saved.version, 1);
      assert.equal(saved.defaultBranch, 'main');
      assert.deepEqual(saved.protectedBranches, ['main']);
      assert.ok(saved.allowedBranchPatterns.includes('feature/*'));
      assert.equal(saved.requireCleanWorkingTreeForMerge, true);
      assert.equal(saved.preventDirectCommitToProtectedBranches, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects executable command fields in policy.json', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await atomicWrite(
        getPolicyPath(root),
        `${JSON.stringify({ ...policy, hooks: ['npm test'] }, null, 2)}\n`,
      );

      await assert.rejects(
        () => repo.policyStore.load(),
        (error: Error) => error.message.includes('executable commands'),
      );
    } finally {
      await cleanup();
    }
  });
});

describe('protected branch commits', () => {
  it('allows the first commit on main then blocks direct commits', async () => {
    const { root, repo, cleanup } = await createTempRepo({ strictPolicy: true });
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      await writeProjectFile(root, 'main.txt', 'main change');
      await repo.add(['main.txt']);

      await assert.rejects(
        () => repo.commit('direct on main'),
        (error: Error) => error.message.includes('protected branch'),
      );
    } finally {
      await cleanup();
    }
  });

  it('allows merge --continue on a protected branch', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/auth/token.ts', 'base-token');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('base');

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('main');

      await new MergeEngine(repo).merge('feature/sample');
      await writeProjectFile(root, 'src/auth/token.ts', 'resolved-token');
      const { MergeResolveEngine } = await import('../src/core/merge/merge-resolve.js');
      await new MergeResolveEngine(repo).resolve(['src/auth/token.ts']);

      const result = await new MergeEngine(repo).continue();
      assert.equal(result.type, 'completed');
      assert.equal(result.branch, 'main');
      assert.ok(result.commitHash);
    } finally {
      await cleanup();
    }
  });
});

describe('policy warnings', () => {
  it('warns when a commit touches many files', () => {
    const warnings = collectCommitPolicyWarnings(150, { ...policy, warnChangedFilesAbove: 100 });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /150 files/);
  });

  it('warns on shared paths during merge preview', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'shared.txt', 'base');
      await repo.add(['shared.txt']);
      await repo.commit('base');

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'shared.txt', 'feature');
      await repo.add(['shared.txt']);
      await repo.commit('feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'shared.txt', 'main');
      await repo.add(['shared.txt']);
      await repo.commit('main');

      const preview = await computeMergePreview(repo, 'feature/sample');
      const warnings = collectMergePolicyWarnings(preview, policy);
      assert.ok(warnings.some((warning) => warning.includes('changed on both branches')));
    } finally {
      await cleanup();
    }
  });
});

describe('doctor policy checks', () => {
  it('reports branches that violate allowedBranchPatterns', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('initial');

      const head = await repo.refs.getHead();
      await repo.refs.setBranch('legacy-flat', head);

      const issues = await new IntegrityChecker(repo).run();
      assert.ok(
        issues.some((issue) => issue.includes('legacy-flat') && issue.includes('violates policy')),
      );
    } finally {
      await cleanup();
    }
  });

  it('reports missing policy.json on older repositories', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const { unlink } = await import('../src/utils/file-system.js');
      await unlink(getPolicyPath(root));

      const issues = repo.policyStore.verify();
      assert.ok(issues.some((issue) => issue.includes('Missing .migit/policy.json')));
    } finally {
      await cleanup();
    }
  });
});

describe('requireCleanWorkingTreeForMerge policy', () => {
  it('allows dirty merges when policy disables the requirement', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      const store = new PolicyStore(root);
      await store.save({
        ...policy,
        requireCleanWorkingTreeForMerge: false,
      });

      await writeProjectFile(root, 'shared.txt', 'base');
      await repo.add(['shared.txt']);
      await repo.commit('base');

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'feature.txt', 'feature');
      await repo.add(['feature.txt']);
      await repo.commit('feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'dirty.txt', 'unstaged');

      const result = await new MergeEngine(repo).merge('feature/sample');
      assert.equal(result.type, 'fast-forward');
    } finally {
      await cleanup();
    }
  });
});

describe('assertDirectCommitAllowed', () => {
  it('allows protected branch commits when history is empty', () => {
    assert.doesNotThrow(() =>
      assertDirectCommitAllowed('main', policy, { hasExistingCommits: false }),
    );
  });

  it('blocks protected branch commits when history exists', () => {
    assert.throws(
      () => assertDirectCommitAllowed('main', policy, { hasExistingCommits: true }),
      MiGitError,
    );
  });
});
