/**
 * branch-policy.ts — enforce declarative rules from `.migit/policy.json`.
 */

import type { MiGitPolicy } from '../types/index.js';
import type { MergePreviewResult } from '../core/merge/merge-preview.js';
import { MiGitError } from './errors.js';

/**
 * matchBranchPattern — glob match for branch names.
 * `*` matches one path segment; `**` matches any suffix.
 */
export function matchBranchPattern(branchName: string, pattern: string): boolean {
  if (pattern === branchName) {
    return true;
  }

  let regex = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      regex += '.*';
      index++;
    } else if (char === '*') {
      regex += '[^/]+';
    } else if (/[.+?^${}()|[\]\\]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += '$';

  return new RegExp(regex).test(branchName);
}

export function isProtectedBranch(branchName: string, policy: MiGitPolicy): boolean {
  return policy.protectedBranches.includes(branchName);
}

export function matchesAllowedBranchPattern(
  branchName: string,
  policy: MiGitPolicy,
): boolean {
  if (branchName === policy.defaultBranch) {
    return true;
  }

  return policy.allowedBranchPatterns.some((pattern) =>
    matchBranchPattern(branchName, pattern),
  );
}

/** Throws when a new branch name violates allowedBranchPatterns. */
export function validateBranchPolicy(branchName: string, policy: MiGitPolicy): void {
  if (matchesAllowedBranchPattern(branchName, policy)) {
    return;
  }

  throw new MiGitError(
    `Branch "${branchName}" is not allowed by policy. ` +
      `Use a pattern such as ${policy.allowedBranchPatterns.join(', ')} ` +
      `or the default branch "${policy.defaultBranch}".`,
  );
}

/** Non-throwing check for doctor warnings. */
export function branchPolicyIssue(branchName: string, policy: MiGitPolicy): string | null {
  try {
    validateBranchPolicy(branchName, policy);
    return null;
  } catch (error) {
    if (error instanceof MiGitError) {
      return error.message;
    }
    throw error;
  }
}

/** Suggest a task branch name from staged file paths (e.g. src/app.ts → feature/change-app). */
export function suggestWorkingBranchName(changedPaths: string[]): string {
  const first = changedPaths[0] ?? 'my-change';
  const baseName = first.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'my-change';
  const slug =
    baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-change';

  return `feature/change-${slug}`;
}

export function formatProtectedBranchCommitError(
  branchName: string,
  changedPaths: string[] = [],
): string {
  const suggested = suggestWorkingBranchName(changedPaths);

  return (
    `Direct commits to protected branch "${branchName}" are not allowed.\n\n` +
    `Create a working branch:\n\n` +
    `  migit branch ${suggested}\n` +
    `  migit checkout ${suggested}`
  );
}

export function assertDirectCommitAllowed(
  branchName: string,
  policy: MiGitPolicy,
  options: { hasExistingCommits: boolean; changedPaths?: string[]; overridePolicy?: boolean },
): void {
  if (options.overridePolicy) {
    return;
  }

  if (!policy.preventDirectCommitToProtectedBranches) {
    return;
  }

  if (!options.hasExistingCommits) {
    return;
  }

  if (!isProtectedBranch(branchName, policy)) {
    return;
  }

  throw new MiGitError(
    formatProtectedBranchCommitError(branchName, options.changedPaths ?? []),
  );
}

export function shouldRequireCleanWorkingTreeForMerge(policy: MiGitPolicy): boolean {
  return policy.requireCleanWorkingTreeForMerge;
}

export function collectCommitPolicyWarnings(
  changedFileCount: number,
  policy: MiGitPolicy,
): string[] {
  const warnings: string[] = [];

  if (changedFileCount > policy.warnChangedFilesAbove) {
    warnings.push(
      `This commit changes ${changedFileCount} files (policy warns above ${policy.warnChangedFilesAbove}).`,
    );
  }

  return warnings;
}

export function collectMergePolicyWarnings(
  preview: MergePreviewResult,
  policy: MiGitPolicy,
): string[] {
  const warnings: string[] = [];
  let changedCount = preview.fastForwardFilesUpdated ?? 0;

  if (preview.counts) {
    changedCount =
      preview.counts.changedOnlyOurs +
      preview.counts.changedOnlyTheirs +
      preview.counts.changedBoth +
      preview.counts.conflicts;
  }

  if (changedCount > policy.warnChangedFilesAbove) {
    warnings.push(
      `This merge would change ${changedCount} files (policy warns above ${policy.warnChangedFilesAbove}).`,
    );
  }

  if (policy.warnSharedPaths && preview.counts && preview.counts.changedBoth > 0) {
    warnings.push(
      `${preview.counts.changedBoth} path${preview.counts.changedBoth === 1 ? '' : 's'} changed on both branches — review carefully before merging.`,
    );
  }

  return warnings;
}

export function collectFastForwardMergePolicyWarnings(
  filesUpdated: number,
  policy: MiGitPolicy,
): string[] {
  const warnings: string[] = [];

  if (filesUpdated > policy.warnChangedFilesAbove) {
    warnings.push(
      `This merge would update ${filesUpdated} files (policy warns above ${policy.warnChangedFilesAbove}).`,
    );
  }

  return warnings;
}

export function formatPolicyWarnings(warnings: string[]): string {
  return warnings.map((warning) => `Policy warning: ${warning}`).join('\n');
}
