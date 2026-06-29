import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeTextFile,
  mergeThreeWayText,
  diffReplaceRegions,
} from '../src/core/merge/content-merge.js';

describe('content merge', () => {
  it('merges non-overlapping line edits on different lines', () => {
    const base = [
      'const port = 3000;',
      'const host = "localhost";',
    ].join('\n');
    const ours = [
      'const port = 5000;',
      'const host = "localhost";',
    ].join('\n');
    const theirs = [
      'const port = 3000;',
      'const host = "0.0.0.0";',
    ].join('\n');

    const result = mergeTextFile({ base, ours, theirs });
    assert.equal(result.clean, true);
    assert.equal(result.conflicts.length, 0);
    assert.equal(
      result.content.toString('utf8'),
      ['const port = 5000;', 'const host = "0.0.0.0";'].join('\n'),
    );
  });

  it('merges non-overlapping line edits from both branches', () => {
    const base = 'line1\nline2\nline3';
    const ours = 'line1\nline2-main\nline3';
    const theirs = 'line1\nline2\nline3-feature';

    const result = mergeTextFile({ base, ours, theirs });
    assert.equal(result.clean, true);
    assert.equal(result.content.toString('utf8'), 'line1\nline2-main\nline3-feature');
  });

  it('reports line conflicts when both branches edit the same line region differently', () => {
    const base = 'line1\nline2\nline3';
    const ours = 'line1\nours\nline3';
    const theirs = 'line1\ntheirs\nline3';

    const result = mergeTextFile({ base, ours, theirs });
    assert.equal(result.clean, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]?.startLine, 2);
    assert.deepEqual(result.conflicts[0]?.baseLines, ['line2']);
    assert.deepEqual(result.conflicts[0]?.ourLines, ['ours']);
    assert.deepEqual(result.conflicts[0]?.theirLines, ['theirs']);
    assert.equal(mergeThreeWayText(base, ours, theirs), null);
  });

  it('embeds current, base, and incoming conflict markers with branch names', () => {
    const base = 'const tokenExpiry = "12h";';
    const ours = 'const tokenExpiry = "1h";';
    const theirs = 'const tokenExpiry = "24h";';

    const result = mergeTextFile({
      base,
      ours,
      theirs,
      currentBranch: 'main',
      incomingBranch: 'feature/login',
    });

    assert.equal(result.clean, false);
    assert.equal(
      result.content.toString('utf8'),
      [
        '<<<<<<< current:main',
        'const tokenExpiry = "1h";',
        '||||||| base',
        'const tokenExpiry = "12h";',
        '=======',
        'const tokenExpiry = "24h";',
        '>>>>>>> incoming:feature/login',
      ].join('\n'),
    );
  });

  it('preserves non-conflicting lines around conflict markers', () => {
    const base = 'header\nshared\nfooter';
    const ours = 'header\nours\nfooter';
    const theirs = 'header\ntheirs\nfooter';

    const result = mergeTextFile({
      base,
      ours,
      theirs,
      currentBranch: 'main',
      incomingBranch: 'feature',
    });

    assert.equal(result.clean, false);
    assert.equal(
      result.content.toString('utf8'),
      [
        'header',
        '<<<<<<< current:main',
        'ours',
        '||||||| base',
        'shared',
        '=======',
        'theirs',
        '>>>>>>> incoming:feature',
        'footer',
      ].join('\n'),
    );
  });

  it('accepts identical edits on overlapping regions', () => {
    const base = 'alpha\nbeta\ngamma';
    const ours = 'alpha\nBETA\ngamma';
    const theirs = 'alpha\nBETA\ngamma';

    const result = mergeTextFile({ base, ours, theirs });
    assert.equal(result.clean, true);
    assert.equal(result.content.toString('utf8'), 'alpha\nBETA\ngamma');
  });

  it('extracts replace regions against the base line list', () => {
    const base = ['a', 'b', 'c'];
    const side = ['a', 'B', 'c'];
    const regions = diffReplaceRegions(base, side);

    assert.equal(regions.length, 1);
    assert.deepEqual(regions[0], { baseStart: 1, baseEnd: 2, sideLines: ['B'] });
  });
});
