/**
 * conflict-risk.ts — hash-only early conflict risk analysis (no blob reads).
 *
 * Compares paths changed on each branch since the merge base and reports overlap.
 * Does not promise conflicts will occur — only warns about overlapping edits.
 */

import type { Repository } from '../repository.js';
import { isAncestor } from './ancestry.js';
import { findMergeBase } from './merge-base.js';
import { resolveMergeBranches } from './merge-common.js';
import { loadMergeTrees } from './tree-merge.js';
import { countTreeChanges } from '../working-tree.js';

export type ConflictRiskMergeType = 'already-up-to-date' | 'fast-forward' | 'three-way';

export interface ConflictRiskReport {
  currentBranch: string;
  incomingBranch: string;
  mergeBase: string | null;
  mergeType: ConflictRiskMergeType;
  lowRiskCount: number;
  possibleOverlap: string[];
  highRiskGenerated: string[];
  ourChangedPaths: string[];
  theirChangedPaths: string[];
}

const HIGH_RISK_BASENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'DOCUMENTATION.md',
]);

const HIGH_RISK_PATH_PATTERNS = [
  /(^|\/)index\.(ts|tsx|js|jsx)$/,
  /(^|\/)routes\/index\.(ts|tsx|js|jsx)$/,
  /(^|\/)config\.(ts|js|json)$/,
  /\.config\.(ts|js|mjs|cjs)$/,
  /(^|\/)barrel\.(ts|js)$/,
];

/** Paths whose blob hash differs between base and a side commit tree. */
export function pathsChangedSinceBase(
  baseTree: Map<string, string>,
  sideTree: Map<string, string>,
): Set<string> {
  const changed = new Set<string>();

  for (const path of new Set([...baseTree.keys(), ...sideTree.keys()])) {
    if (baseTree.get(path) !== sideTree.get(path)) {
      changed.add(path);
    }
  }

  return changed;
}

/** Intersection of paths changed on both branches since merge base. */
export function computePossibleOverlap(
  ourChangedPaths: Set<string>,
  theirChangedPaths: Set<string>,
): string[] {
  return [...ourChangedPaths]
    .filter((path) => theirChangedPaths.has(path))
    .sort((left, right) => left.localeCompare(right));
}

export function countLowRiskPaths(
  ourChangedPaths: Set<string>,
  theirChangedPaths: Set<string>,
  overlap: string[],
): number {
  const overlapSet = new Set(overlap);
  let count = 0;

  for (const path of ourChangedPaths) {
    if (!overlapSet.has(path)) {
      count++;
    }
  }

  for (const path of theirChangedPaths) {
    if (!overlapSet.has(path)) {
      count++;
    }
  }

  return count;
}

export function isHighRiskGeneratedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const baseName = normalized.split('/').pop() ?? normalized;

  if (HIGH_RISK_BASENAMES.has(baseName)) {
    return true;
  }

  return HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function filterHighRiskGeneratedPaths(overlap: string[]): string[] {
  return overlap.filter(isHighRiskGeneratedPath);
}

function buildReport(
  context: {
    currentBranch: string;
    incomingBranch: string;
    mergeBase: string | null;
    mergeType: ConflictRiskMergeType;
  },
  ourChanged: Set<string>,
  theirChanged: Set<string>,
): ConflictRiskReport {
  const possibleOverlap = computePossibleOverlap(ourChanged, theirChanged);

  return {
    currentBranch: context.currentBranch,
    incomingBranch: context.incomingBranch,
    mergeBase: context.mergeBase,
    mergeType: context.mergeType,
    lowRiskCount: countLowRiskPaths(ourChanged, theirChanged, possibleOverlap),
    possibleOverlap,
    highRiskGenerated: filterHighRiskGeneratedPaths(possibleOverlap),
    ourChangedPaths: [...ourChanged].sort((a, b) => a.localeCompare(b)),
    theirChangedPaths: [...theirChanged].sort((a, b) => a.localeCompare(b)),
  };
}

export async function computeConflictRisk(
  repo: Repository,
  incomingBranchName: string,
): Promise<ConflictRiskReport> {
  const { currentBranch, incomingBranch, ourHead, theirHead } =
    await resolveMergeBranches(repo, incomingBranchName);

  const ancestryOptions = { rootDir: repo.rootDir };

  if (ourHead === theirHead) {
    return buildReport(
      {
        currentBranch,
        incomingBranch,
        mergeBase: ourHead,
        mergeType: 'already-up-to-date',
      },
      new Set(),
      new Set(),
    );
  }

  const alreadyMerged = await isAncestor(
    repo.objectStore,
    theirHead,
    ourHead,
    ancestryOptions,
  );

  if (alreadyMerged) {
    return buildReport(
      {
        currentBranch,
        incomingBranch,
        mergeBase: theirHead,
        mergeType: 'already-up-to-date',
      },
      new Set(),
      new Set(),
    );
  }

  const canFastForward = await isAncestor(
    repo.objectStore,
    ourHead,
    theirHead,
    ancestryOptions,
  );

  if (canFastForward) {
    const ourCommit = await repo.objectStore.readCommit(ourHead);
    const theirCommit = await repo.objectStore.readCommit(theirHead);
    const ourTree = await repo.objectStore.readTree(ourCommit.tree);
    const theirTree = await repo.objectStore.readTree(theirCommit.tree);
    const theirOnly = pathsChangedSinceBase(ourTree, theirTree);

    return buildReport(
      {
        currentBranch,
        incomingBranch,
        mergeBase: ourHead,
        mergeType: 'fast-forward',
      },
      new Set(),
      theirOnly,
    );
  }

  const mergeBase = await findMergeBase(
    repo.objectStore,
    ourHead,
    theirHead,
    ancestryOptions,
  );

  const { baseTree, ourTree, theirTree } = await loadMergeTrees(
    repo.objectStore,
    mergeBase,
    ourHead,
    theirHead,
  );

  return buildReport(
    {
      currentBranch,
      incomingBranch,
      mergeBase,
      mergeType: 'three-way',
    },
    pathsChangedSinceBase(baseTree, ourTree),
    pathsChangedSinceBase(baseTree, theirTree),
  );
}

export function formatConflictRiskReport(report: ConflictRiskReport): string {
  const lines: string[] = ['Conflict risk report', ''];

  lines.push(`Current branch: ${report.currentBranch}`);
  lines.push(`Incoming branch: ${report.incomingBranch}`);

  if (report.mergeBase) {
    lines.push(`Merge base: ${report.mergeBase.slice(0, 7)}`);
  }

  lines.push('');

  if (report.mergeType === 'already-up-to-date') {
    lines.push('Already up to date — no overlapping changes to analyze.');
    lines.push('');
    lines.push(
      'This does not promise that a conflict will happen. It warns about overlapping paths.',
    );
    return lines.join('\n');
  }

  if (report.mergeType === 'fast-forward') {
    lines.push('Low risk:');
    lines.push(
      `  ${report.lowRiskCount} file${report.lowRiskCount === 1 ? '' : 's'} changed on only one branch`,
    );
    lines.push('');
    lines.push('Fast-forward merge — no overlapping edits since merge base.');
    lines.push('');
    lines.push(
      'This does not promise that a conflict will happen. It warns about overlapping paths.',
    );
    return lines.join('\n');
  }

  lines.push('Low risk:');
  lines.push(
    `  ${report.lowRiskCount} file${report.lowRiskCount === 1 ? '' : 's'} changed on only one branch`,
  );
  lines.push('');

  if (report.possibleOverlap.length > 0) {
    lines.push('Possible overlap:');
    for (const path of report.possibleOverlap) {
      lines.push(`  ${path}`);
    }
    lines.push('');
  } else {
    lines.push('Possible overlap:');
    lines.push('  (none)');
    lines.push('');
  }

  if (report.highRiskGenerated.length > 0) {
    lines.push('High-risk generated files:');
    for (const path of report.highRiskGenerated) {
      lines.push(`  ${path}`);
    }
    lines.push('');
  }

  lines.push(
    'This does not promise that a conflict will happen. It warns about overlapping paths.',
  );

  return lines.join('\n');
}

/**
 * Verify hash-only analysis: fast-forward low-risk count matches tree diff size.
 */
export function fastForwardLowRiskCount(
  ourTree: Map<string, string>,
  theirTree: Map<string, string>,
): number {
  return countTreeChanges(ourTree, theirTree);
}
