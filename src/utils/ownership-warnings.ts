/**
 * ownership-warnings.ts — team ownership coordination warnings (non-blocking).
 */

import type { MiGitOwnership } from '../types/index.js';

export interface OwnershipWarning {
  path: string;
  branchTeam: string;
  ownerTeam: string;
}

/**
 * matchPathPattern — glob match for repository file paths.
 * `*` matches within one segment; `**` matches any suffix.
 */
export function matchPathPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  let regex = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      regex += '.*';
      index++;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (/[.+?^${}()|[\]\\]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += '$';

  return new RegExp(regex).test(normalized);
}

/** Returns the team from branch names like team/frontend/dashboard. */
export function extractBranchTeam(branchName: string): string | null {
  const segments = branchName.split('/');
  if (segments[0] !== 'team' || segments.length < 2 || !segments[1]) {
    return null;
  }

  return segments[1];
}

export function findOwnerTeam(path: string, ownership: MiGitOwnership): string | null {
  for (const rule of ownership.rules) {
    if (matchPathPattern(path, rule.pattern)) {
      return rule.team;
    }
  }

  return null;
}

export function collectOwnershipWarnings(
  branchName: string,
  changedPaths: string[],
  ownership: MiGitOwnership,
): OwnershipWarning[] {
  const branchTeam = extractBranchTeam(branchName);
  if (!branchTeam) {
    return [];
  }

  const warnings: OwnershipWarning[] = [];

  for (const path of changedPaths) {
    const ownerTeam = findOwnerTeam(path, ownership);
    if (ownerTeam && ownerTeam !== branchTeam) {
      warnings.push({ path, branchTeam, ownerTeam });
    }
  }

  return warnings.sort((left, right) => left.path.localeCompare(right.path));
}

export function formatOwnershipWarnings(
  branchName: string,
  warnings: OwnershipWarning[],
): string {
  if (warnings.length === 0) {
    return '';
  }

  const byOwner = new Map<string, string[]>();
  for (const warning of warnings) {
    const paths = byOwner.get(warning.ownerTeam) ?? [];
    paths.push(warning.path);
    byOwner.set(warning.ownerTeam, paths);
  }

  const lines = ['Warning:', '', 'Branch:', `  ${branchName}`, ''];

  for (const [ownerTeam, paths] of [...byOwner.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (paths.length === 1) {
      lines.push('Changed path:', `  ${paths[0]}`, '');
    } else {
      lines.push('Changed paths:', ...paths.map((path) => `  ${path}`), '');
    }
    lines.push('Suggested owner:', `  ${ownerTeam}`, '');
  }

  lines.push('This is only a warning. The commit was not blocked.');
  return lines.join('\n');
}
