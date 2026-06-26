/**
 * diff-redactor.ts — line diffs and redacted snippets safe for external APIs.
 */

import { redactSecrets } from '../utils/redact-secrets.js';

const MAX_LINE_LENGTH = 120;
const MAX_DIFF_SAMPLE_LINES = 12;

export function isBinaryContent(content: Buffer): boolean {
  return content.includes(0);
}

export function redactLine(line: string): string {
  let result = redactSecrets(line);
  if (result.length > MAX_LINE_LENGTH) {
    return `${result.slice(0, MAX_LINE_LENGTH - 3)}...`;
  }
  return result;
}

export interface LineDiffResult {
  addedLines: number;
  deletedLines: number;
  added: string[];
  removed: string[];
}

/**
 * computeLineDiff — LCS-based line diff for added/deleted counts and samples.
 */
export function computeLineDiff(oldText: string, newText: string): LineDiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const lcs = buildLcsTable(oldLines, newLines);

  const removed: string[] = [];
  const added: string[] = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      i--;
      j--;
      continue;
    }

    if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      added.push(newLines[j - 1]);
      j--;
    } else if (i > 0) {
      removed.push(oldLines[i - 1]);
      i--;
    }
  }

  added.reverse();
  removed.reverse();

  return {
    addedLines: added.length,
    deletedLines: removed.length,
    added,
    removed,
  };
}

export function buildDiffSample(removed: string[], added: string[]): string[] {
  const sample: string[] = [];

  for (const line of removed) {
    if (sample.length >= MAX_DIFF_SAMPLE_LINES) break;
    sample.push(`- ${redactLine(line)}`);
  }

  for (const line of added) {
    if (sample.length >= MAX_DIFF_SAMPLE_LINES) break;
    sample.push(`+ ${redactLine(line)}`);
  }

  return sample;
}

export function summarizeLineChanges(added: string[], removed: string[]): string[] {
  const bullets: string[] = [];

  for (const line of added) {
    const hint = describeLine(line, 'add');
    if (hint && !bullets.includes(hint)) bullets.push(hint);
    if (bullets.length >= 5) return bullets;
  }

  for (const line of removed) {
    const hint = describeLine(line, 'remove');
    if (hint && !bullets.includes(hint)) bullets.push(hint);
    if (bullets.length >= 5) return bullets;
  }

  return bullets;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

function describeLine(line: string, kind: 'add' | 'remove'): string | null {
  const text = line.trim();
  if (!text || text === '{' || text === '}' || text === '};') {
    return null;
  }

  const nameMatch = text.match(
    /(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  );
  if (nameMatch) {
    const verb = kind === 'add' ? 'Added' : 'Removed';
    return `${verb} ${nameMatch[1]}`;
  }

  if (/^import\s/.test(text)) {
    return kind === 'add' ? 'Added import' : 'Removed import';
  }

  if (/throw\s+new\s+\w*Error/.test(text) || /catch\s*\(/.test(text)) {
    return kind === 'add' ? 'Added error handling' : 'Removed error handling';
  }

  if (/expire|expiration|token|auth|login|logout|password/i.test(text)) {
    return kind === 'add'
      ? 'Added authentication-related logic'
      : 'Removed authentication-related logic';
  }

  if (kind === 'add' && /\/\/|\/\*|\*\//.test(text) && text.length < 80) {
    return 'Added comments';
  }

  return null;
}
