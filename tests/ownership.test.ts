import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTempRepo, writeProjectFile } from './helpers/temp-repo.js';
import { Repository } from '../src/core/repository.js';
import { CheckoutEngine } from '../src/core/checkout-engine.js';
import {
  matchPathPattern,
  extractBranchTeam,
  collectOwnershipWarnings,
  formatOwnershipWarnings,
} from '../src/utils/ownership-warnings.js';
import { createDefaultOwnership } from '../src/core/ownership-store.js';
import { getOwnershipPath } from '../src/utils/paths.js';

const ownership = createDefaultOwnership();

describe('ownership path matching', () => {
  it('matches default ownership globs', () => {
    assert.ok(matchPathPattern('src/api/users.ts', 'src/api/**'));
    assert.ok(matchPathPattern('src/components/Button.tsx', 'src/components/**'));
    assert.ok(matchPathPattern('src/models/User.ts', 'src/models/**'));
    assert.ok(matchPathPattern('infra/terraform/main.tf', 'infra/**'));
    assert.ok(!matchPathPattern('src/utils/helpers.ts', 'src/api/**'));
  });

  it('extracts team from team branch names', () => {
    assert.equal(extractBranchTeam('team/frontend/dashboard'), 'frontend');
    assert.equal(extractBranchTeam('team/backend/order-service'), 'backend');
    assert.equal(extractBranchTeam('feature/login'), null);
  });
});

describe('ownership.json on init', () => {
  it('writes the default ownership file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-ownership-init-'));
    try {
      const repo = Repository.at(root);
      await repo.init();

      const raw = await readFile(getOwnershipPath(root), 'utf8');
      const saved = JSON.parse(raw);
      assert.ok(Array.isArray(saved.rules));
      assert.ok(saved.rules.some((rule: { pattern: string }) => rule.pattern === 'src/api/**'));
      assert.ok(saved.rules.some((rule: { team: string }) => rule.team === 'backend'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('team ownership warnings on commit', () => {
  it('warns when a frontend branch changes a backend-owned path', () => {
    const warnings = collectOwnershipWarnings(
      'team/frontend/dashboard',
      ['src/api/users.ts'],
      ownership,
    );

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].ownerTeam, 'backend');

    const message = formatOwnershipWarnings('team/frontend/dashboard', warnings);
    assert.match(message, /^Warning:/);
    assert.match(message, /team\/frontend\/dashboard/);
    assert.match(message, /src\/api\/users\.ts/);
    assert.match(message, /Suggested owner:\n  backend/);
    assert.match(message, /This is only a warning\. The commit was not blocked\./);
  });

  it('does not warn when paths match the branch team', () => {
    const warnings = collectOwnershipWarnings(
      'team/frontend/dashboard',
      ['src/components/Button.tsx'],
      ownership,
    );
    assert.equal(warnings.length, 0);
  });

  it('does not warn for non-team branches', () => {
    const warnings = collectOwnershipWarnings(
      'feature/login',
      ['src/api/users.ts'],
      ownership,
    );
    assert.equal(warnings.length, 0);
  });

  it('allows the commit despite ownership warnings', async () => {
    const { root, repo, cleanup } = await createTempRepo();
    try {
      await writeProjectFile(root, 'src/api/users.ts', 'base\n');
      await repo.add(['src/api/users.ts']);
      await repo.commit('initial');

      const head = await repo.refs.getHead();
      await repo.refs.setBranch('team/frontend/dashboard', head);
      await new CheckoutEngine(repo).checkout('team/frontend/dashboard');
      await writeProjectFile(root, 'src/api/users.ts', 'base\nchange\n');
      await repo.add(['src/api/users.ts']);

      const hash = await repo.commit('Update users API');
      assert.ok(hash);
    } finally {
      await cleanup();
    }
  });
});
