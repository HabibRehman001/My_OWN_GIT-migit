/**
 * branch-standards.ts — simple branch naming conventions for MiGit.
 *
 * Trunk is `main`. Task branches use allowed prefixes (feature/, bugfix/, etc.).
 * Validation runs on branch create; doctor warns on existing non-compliant names.
 */

import type { MiGitConfig } from '../types/index.js';
import { MiGitError } from './errors.js';

export const DEFAULT_BRANCH = 'main';

export const DEFAULT_ALLOWED_PREFIXES = [
  'feature',
  'bugfix',
  'hotfix',
  'docs',
  'team',
] as const;

export const DEFAULT_MIN_DESCRIPTION_LENGTH = 3;

const VAGUE_SLUGS = new Set(['work', 'temp', 'wip', 'stuff', 'branch', 'test']);

const LONG_LIVED_PATTERN = /work-for-next|six-months|long-lived/i;

export interface BranchStandards {
  enabled: boolean;
  defaultBranch: string;
  allowedPrefixes: string[];
  minDescriptionLength: number;
}

export function resolveBranchStandards(config?: MiGitConfig): BranchStandards {
  const branches = config?.branches;

  return {
    enabled: branches?.enabled !== false,
    defaultBranch: branches?.defaultBranch?.trim() || DEFAULT_BRANCH,
    allowedPrefixes:
      branches?.allowedPrefixes?.length && branches.allowedPrefixes.length > 0
        ? branches.allowedPrefixes.map((prefix) => prefix.trim()).filter(Boolean)
        : [...DEFAULT_ALLOWED_PREFIXES],
    minDescriptionLength: branches?.minDescriptionLength ?? DEFAULT_MIN_DESCRIPTION_LENGTH,
  };
}

/**
 * validateBranchStandards — throws when a name violates configured conventions.
 * The default trunk branch is always exempt.
 */
export function validateBranchStandards(name: string, standards: BranchStandards): void {
  if (!standards.enabled) {
    return;
  }

  if (name === standards.defaultBranch) {
    return;
  }

  const segments = name.split('/');
  const prefix = segments[0];

  if (!standards.allowedPrefixes.includes(prefix)) {
    throw new MiGitError(
      `Branch "${name}" must use an allowed prefix (${standards.allowedPrefixes.join(', ')}) or the trunk branch "${standards.defaultBranch}".`,
    );
  }

  if (prefix === 'team') {
    if (segments.length < 3) {
      throw new MiGitError(
        `Team branches need at least two levels after team/ (e.g. team/backend/order-service).`,
      );
    }
    for (const segment of segments.slice(1)) {
      validateSegment(segment, standards);
    }
    return;
  }

  if (segments.length !== 2) {
    throw new MiGitError(
      `Branch "${name}" must be <prefix>/<task-slug> (e.g. feature/user-login).`,
    );
  }

  validateSlug(segments[1], standards);
}

/** Non-throwing check for doctor warnings. */
export function branchStandardsIssue(
  name: string,
  standards: BranchStandards,
): string | null {
  try {
    validateBranchStandards(name, standards);
    return null;
  } catch (error) {
    if (error instanceof MiGitError) {
      return error.message;
    }
    throw error;
  }
}

export function formatBranchStandardsHelp(standards: BranchStandards): string {
  const lines = [
    'MiGit branch naming standards:',
    `  Trunk: ${standards.defaultBranch}`,
    `  Allowed prefixes: ${standards.allowedPrefixes.join(', ')}`,
    '  Examples:',
    '    feature/user-login',
    '    bugfix/token-expiry',
    '    hotfix/database-connection',
    '    docs/api-documentation',
    '    team/backend/order-service',
    '    feature/DS-142-login-validation',
    '  Avoid long-lived vague branches (e.g. backend-team-work-for-next-six-months).',
    '  Use --no-verify on branch create to skip validation.',
  ];

  return lines.join('\n');
}

function validateSegment(segment: string, standards: BranchStandards): void {
  if (segment.length < standards.minDescriptionLength) {
    throw new MiGitError(
      `Branch segment "${segment}" is too short. Use descriptive names (min ${standards.minDescriptionLength} characters).`,
    );
  }
}

function validateSlug(slug: string, standards: BranchStandards): void {
  validateSegment(slug, standards);

  if (VAGUE_SLUGS.has(slug.toLowerCase())) {
    throw new MiGitError(
      `Branch slug "${slug}" is too vague. Prefer short-lived task branches (e.g. feature/DS-142-login-validation).`,
    );
  }

  if (LONG_LIVED_PATTERN.test(slug)) {
    throw new MiGitError(
      `Branch "${slug}" looks like a long-lived branch name. Prefer short-lived task branches.`,
    );
  }
}
