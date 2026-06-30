/**
 * policy-store.ts — loads and saves `.migit/policy.json` (declarative rules only).
 */

import { readFileSync } from 'node:fs';
import type { MiGitPolicy } from '../types/index.js';
import { getPolicyPath } from '../utils/paths.js';
import { readFile, existsSync } from '../utils/file-system.js';
import { MiGitError } from '../utils/errors.js';
import { atomicWrite } from '../utils/atomic-write.js';

export const POLICY_VERSION = 1;

export function createDefaultPolicy(): MiGitPolicy {
  return {
    version: POLICY_VERSION,
    defaultBranch: 'main',
    protectedBranches: ['main'],
    allowedBranchPatterns: [
      'feature/*',
      'bugfix/*',
      'hotfix/*',
      'docs/*',
      'team/*',
    ],
    requireCleanWorkingTreeForMerge: true,
    preventDirectCommitToProtectedBranches: true,
    warnChangedFilesAbove: 100,
    warnSharedPaths: true,
  };
}

function mergeWithDefaults(partial: Partial<MiGitPolicy>): MiGitPolicy {
  const defaults = createDefaultPolicy();

  return {
    version: partial.version ?? defaults.version,
    defaultBranch: partial.defaultBranch?.trim() || defaults.defaultBranch,
    protectedBranches:
      partial.protectedBranches?.length && partial.protectedBranches.length > 0
        ? partial.protectedBranches.map((branch) => branch.trim()).filter(Boolean)
        : defaults.protectedBranches,
    allowedBranchPatterns:
      partial.allowedBranchPatterns?.length && partial.allowedBranchPatterns.length > 0
        ? partial.allowedBranchPatterns.map((pattern) => pattern.trim()).filter(Boolean)
        : defaults.allowedBranchPatterns,
    requireCleanWorkingTreeForMerge:
      partial.requireCleanWorkingTreeForMerge ?? defaults.requireCleanWorkingTreeForMerge,
    preventDirectCommitToProtectedBranches:
      partial.preventDirectCommitToProtectedBranches ??
      defaults.preventDirectCommitToProtectedBranches,
    warnChangedFilesAbove: partial.warnChangedFilesAbove ?? defaults.warnChangedFilesAbove,
    warnSharedPaths: partial.warnSharedPaths ?? defaults.warnSharedPaths,
  };
}

function validatePolicyShape(raw: Record<string, unknown>): Partial<MiGitPolicy> {
  for (const key of Object.keys(raw)) {
    if (key === 'hooks' || key === 'commands' || key === 'scripts') {
      throw new MiGitError(
        `Invalid policy field "${key}" — policy.json must not contain executable commands.`,
      );
    }
  }

  return raw as Partial<MiGitPolicy>;
}

export class PolicyStore {
  constructor(private readonly rootDir: string) {}

  exists(): boolean {
    return existsSync(getPolicyPath(this.rootDir));
  }

  async load(): Promise<MiGitPolicy> {
    const path = getPolicyPath(this.rootDir);
    if (!existsSync(path)) {
      return createDefaultPolicy();
    }

    const raw = (await readFile(path)).toString('utf8');
    try {
      return mergeWithDefaults(validatePolicyShape(JSON.parse(raw) as Record<string, unknown>));
    } catch (error) {
      if (error instanceof MiGitError) {
        throw error;
      }
      throw new MiGitError(`Invalid policy at ${path} — expected JSON`);
    }
  }

  async save(policy: MiGitPolicy): Promise<void> {
    const path = getPolicyPath(this.rootDir);
    await atomicWrite(path, `${JSON.stringify(policy, null, 2)}\n`);
  }

  verify(): string[] {
    const issues: string[] = [];
    const path = getPolicyPath(this.rootDir);

    if (!existsSync(path)) {
      issues.push(
        'Missing .migit/policy.json — run "migit init" on a new repo or copy the default policy file',
      );
      return issues;
    }

    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      validatePolicyShape(raw);

      if (typeof raw.version !== 'number') {
        issues.push('policy.json: "version" must be a number');
      }

      if (typeof raw.defaultBranch !== 'string' || !raw.defaultBranch.trim()) {
        issues.push('policy.json: "defaultBranch" must be a non-empty string');
      }
    } catch (error) {
      if (error instanceof MiGitError) {
        issues.push(error.message);
      } else {
        issues.push('Invalid .migit/policy.json — expected JSON');
      }
    }

    return issues;
  }
}
