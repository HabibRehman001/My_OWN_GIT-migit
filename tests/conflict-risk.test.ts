import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import {
  computeConflictRisk,
  computePossibleOverlap,
  countLowRiskPaths,
  formatConflictRiskReport,
  pathsChangedSinceBase,
  isHighRiskGeneratedPath,
} from '../src/core/merge/conflict-risk.js';
import {
  computeMergePreview,
  formatMergePreviewForBranch,
} from '../src/core/merge/merge-preview.js';

describe('conflict risk path analysis', () => {
  it('finds paths changed since merge base on each side', () => {
    const base = new Map([
      ['unchanged.txt', 'hash-a'],
      ['shared.txt', 'hash-base'],
      ['removed.txt', 'hash-old'],
    ]);
    const ours = new Map([
      ['unchanged.txt', 'hash-a'],
      ['shared.txt', 'hash-ours'],
      ['main-only.txt', 'hash-main'],
    ]);
    const theirs = new Map([
      ['unchanged.txt', 'hash-a'],
      ['shared.txt', 'hash-theirs'],
      ['feature-only.txt', 'hash-feature'],
    ]);

    const ourChanged = pathsChangedSinceBase(base, ours);
    const theirChanged = pathsChangedSinceBase(base, theirs);

    assert.deepEqual([...ourChanged].sort(), ['main-only.txt', 'removed.txt', 'shared.txt']);
    assert.deepEqual(
      [...theirChanged].sort(),
      ['feature-only.txt', 'removed.txt', 'shared.txt'],
    );

    const overlap = computePossibleOverlap(ourChanged, theirChanged);
    assert.deepEqual(overlap, ['removed.txt', 'shared.txt']);
    assert.equal(countLowRiskPaths(ourChanged, theirChanged, overlap), 2);
  });

  it('flags high-risk generated file paths', () => {
    assert.ok(isHighRiskGeneratedPath('package-lock.json'));
    assert.ok(isHighRiskGeneratedPath('src/routes/index.ts'));
    assert.ok(!isHighRiskGeneratedPath('src/auth/token.ts'));
  });
});

describe('conflict risk report', () => {
  it('reports low-risk-only changes on diverged branches', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'unchanged.txt', 'same');
      await writeProjectFile(root, 'shared.txt', 'base');
      await repo.add(['unchanged.txt', 'shared.txt']);
      await repo.commit('base');

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'feature-only.txt', 'feature');
      await repo.add(['feature-only.txt']);
      await repo.commit('on feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'main-only.txt', 'main');
      await repo.add(['main-only.txt']);
      await repo.commit('on main');

      const report = await computeConflictRisk(repo, 'feature/sample');
      assert.equal(report.lowRiskCount, 2);
      assert.deepEqual(report.possibleOverlap, []);
      assert.deepEqual(report.highRiskGenerated, []);

      const output = formatConflictRiskReport(report);
      assert.match(output, /Conflict risk report/);
      assert.match(output, /2 files changed on only one branch/);
      assert.match(output, /Possible overlap:\n  \(none\)/);
    } finally {
      await cleanup();
    }
  });

  it('reports overlapping paths and high-risk generated files', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/auth/token.ts', 'base-token');
      await writeProjectFile(root, 'src/routes/user.ts', 'base-user');
      await writeProjectFile(root, 'package-lock.json', 'base-lock');
      await writeProjectFile(root, 'feature-only.txt', 'base-feature');
      await repo.add([
        'src/auth/token.ts',
        'src/routes/user.ts',
        'package-lock.json',
        'feature-only.txt',
      ]);
      await repo.commit('base');

      const head = await repo.refs.getHead();
      await repo.refs.setBranch('feature/login', head);
      await new CheckoutEngine(repo).checkout('feature/login');
      await writeProjectFile(root, 'src/auth/token.ts', 'feature-token');
      await writeProjectFile(root, 'package-lock.json', 'feature-lock');
      await writeProjectFile(root, 'feature-only.txt', 'feature');
      await repo.add(['src/auth/token.ts', 'package-lock.json', 'feature-only.txt']);
      await repo.commit('feature changes');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'src/auth/token.ts', 'main-token');
      await writeProjectFile(root, 'src/routes/user.ts', 'main-user');
      await writeProjectFile(root, 'package-lock.json', 'main-lock');
      await repo.add(['src/auth/token.ts', 'src/routes/user.ts', 'package-lock.json']);
      await repo.commit('main changes');

      const report = await computeConflictRisk(repo, 'feature/login');
      assert.deepEqual(report.possibleOverlap, [
        'package-lock.json',
        'src/auth/token.ts',
      ]);
      assert.deepEqual(report.highRiskGenerated, ['package-lock.json']);
      assert.equal(report.lowRiskCount, 2);

      const output = formatConflictRiskReport(report);
      assert.match(output, /Possible overlap:/);
      assert.match(output, /src\/auth\/token\.ts/);
      assert.match(output, /package-lock\.json/);
      assert.match(output, /High-risk generated files:/);
      assert.match(
        output,
        /This does not promise that a conflict will happen\. It warns about overlapping paths\./,
      );
    } finally {
      await cleanup();
    }
  });

  it('includes conflict risk report in merge --preview output', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/auth/token.ts', 'base');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('base');

      const head = await repo.refs.getHead();
      await repo.refs.setBranch('feature/login', head);
      await new CheckoutEngine(repo).checkout('feature/login');
      await writeProjectFile(root, 'src/auth/token.ts', 'feature');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('feature');

      await new CheckoutEngine(repo).checkout('main');
      await writeProjectFile(root, 'src/auth/token.ts', 'main');
      await repo.add(['src/auth/token.ts']);
      await repo.commit('main');

      const preview = await computeMergePreview(repo, 'feature/login');
      const output = await formatMergePreviewForBranch(repo, 'feature/login', preview);

      assert.match(output, /Conflict risk report/);
      assert.match(output, /Possible overlap:/);
      assert.match(output, /src\/auth\/token\.ts/);
      assert.match(output, /Merge preview/);
    } finally {
      await cleanup();
    }
  });

  it('reports fast-forward merges as low risk on one branch only', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'base.txt', 'base');
      await repo.add(['base.txt']);
      await repo.commit('base');

      await repo.createBranch('feature/sample');
      await new CheckoutEngine(repo).checkout('feature/sample');
      await writeProjectFile(root, 'feature.txt', 'feature');
      await repo.add(['feature.txt']);
      await repo.commit('feature');

      await new CheckoutEngine(repo).checkout('main');

      const report = await computeConflictRisk(repo, 'feature/sample');
      assert.equal(report.mergeType, 'fast-forward');
      assert.equal(report.lowRiskCount, 1);
      assert.deepEqual(report.possibleOverlap, []);
    } finally {
      await cleanup();
    }
  });
});
