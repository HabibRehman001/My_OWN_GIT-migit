import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackMessage } from '../src/ai/commit-fallback.js';
import { buildChangeSummary } from '../src/ai/change-summary.js';
import { normalizeCommitMessage } from '../src/ai/commit-message.js';

describe('smart commit helpers', () => {
  it('fallbackMessage handles single add, delete, and multi-file cases', () => {
    const singleAdd = buildChangeSummary([
      {
        path: 'src/auth.ts',
        changeType: 'added',
        addedLines: 10,
        deletedLines: 0,
        summary: ['Added new file'],
      },
    ]);
    assert.equal(fallbackMessage(singleAdd), 'Add src/auth.ts');

    const withDelete = buildChangeSummary([
      {
        path: 'old.txt',
        changeType: 'deleted',
        addedLines: 0,
        deletedLines: 3,
        summary: ['Removed file'],
      },
    ]);
    assert.equal(fallbackMessage(withDelete), 'Update project files and remove unused files');

    const many = buildChangeSummary([
      {
        path: 'a.ts',
        changeType: 'modified',
        addedLines: 1,
        deletedLines: 1,
        summary: ['Modified file content'],
      },
      {
        path: 'b.ts',
        changeType: 'modified',
        addedLines: 2,
        deletedLines: 0,
        summary: ['Modified file content'],
      },
    ]);
    assert.equal(fallbackMessage(many), 'Update 2 project files');
  });

  it('normalizeCommitMessage enforces single-line 72 char limit', () => {
    assert.equal(normalizeCommitMessage('  "Fix login bug"\n'), 'Fix login bug');
    assert.equal(
      normalizeCommitMessage('x'.repeat(100))?.length,
      72,
    );
    assert.equal(normalizeCommitMessage(''), null);
    assert.equal(normalizeCommitMessage('```'), null);
  });
});
