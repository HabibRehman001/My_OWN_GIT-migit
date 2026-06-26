import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCheckoutBlockers,
  formatCheckoutBlockedMessage,
} from '../src/core/checkout-guard.js';
import type { StatusEntry } from '../src/types/index.js';

describe('checkout-guard', () => {
  const targetTree = new Map([
    ['src/app.ts', 'hash1'],
    ['README.md', 'hash2'],
  ]);

  it('blocks staged and unstaged tracked changes', () => {
    const status: StatusEntry[] = [
      { path: 'src/app.ts', staged: 'modified', working: null },
      { path: 'lib/util.ts', staged: null, working: 'modified' },
    ];
    const blockers = findCheckoutBlockers(status, targetTree);
    assert.deepEqual(blockers, ['lib/util.ts', 'src/app.ts']);
  });

  it('blocks untracked files only when target branch has that path', () => {
    const status: StatusEntry[] = [
      { path: 'README.md', staged: null, working: 'untracked' },
      { path: 'local-only.txt', staged: null, working: 'untracked' },
    ];
    const blockers = findCheckoutBlockers(status, targetTree);
    assert.deepEqual(blockers, ['README.md']);
  });

  it('formats a user-facing blocked checkout message', () => {
    const message = formatCheckoutBlockedMessage(['src/app.ts', 'README.md']);
    assert.match(message, /Checkout stopped/);
    assert.match(message, /src\/app.ts/);
    assert.match(message, /Commit, stage, or remove/);
  });
});
