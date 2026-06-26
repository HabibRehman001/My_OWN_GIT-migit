import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IgnoreRules, parseIgnoreFile } from '../src/utils/ignore-rules.js';

describe('ignore-rules', () => {
  it('parseIgnoreFile skips comments and blank lines', () => {
    const patterns = parseIgnoreFile('# comment\n\n*.log\nbuild/\n');
    assert.equal(patterns.length, 2);
    assert.equal(patterns[0].basenamePattern, '*.log');
    assert.equal(patterns[1].directoryOnly, true);
  });

  it('always ignores .migit and .env even without .migitignore file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-ignore-'));
    try {
      const rules = await IgnoreRules.load(root);
      assert.equal(rules.isIgnored('.migit/index'), true);
      assert.equal(rules.isIgnored('.env'), true);
      assert.equal(rules.isIgnored('src/.env'), true);
      assert.equal(rules.isIgnored('node_modules/pkg/index.js', true), true);
    } finally {
      await rm(root, { recursive: true, force: true });
      IgnoreRules.clearCache();
    }
  });

  it('respects custom .migitignore patterns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-ignore-custom-'));
    try {
      await writeFile(join(root, '.migitignore'), 'uploads/\n*.tmp\n', 'utf8');
      IgnoreRules.clearCache();
      const rules = await IgnoreRules.load(root);
      assert.equal(rules.isIgnored('uploads', true), true);
      assert.equal(rules.isIgnored('cache/file.tmp'), true);
      assert.equal(rules.isIgnored('src/app.ts'), false);
    } finally {
      await rm(root, { recursive: true, force: true });
      IgnoreRules.clearCache();
    }
  });
});
