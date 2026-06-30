/**
 * merge-preview.ts — read-only three-way merge analysis (no working tree changes).
 */

import type { Repository } from '../repository.js';
import { isAncestor } from './ancestry.js';
import { findMergeBase } from './merge-base.js';
import { resolveMergeBranches } from './merge-common.js';
import type { MergeConflict } from './merge-types.js';
import {
  conflictDescription,
  loadMergeTrees,
  mergeTrees,
  summarizeTreeMerge,
} from './tree-merge.js';
import { countTreeChanges } from '../working-tree.js';
import {
  computeConflictRisk,
  formatConflictRiskReport,
} from './conflict-risk.js';

export type MergePreviewKind =
  | 'already-up-to-date'
  | 'fast-forward'
  | 'three-way-clean'
  | 'three-way-conflicts';

export interface MergePreviewConflict {
  path: string;
  kind: MergeConflict['conflictType'];
  description: string;
}

export interface MergePreviewCounts {
  unchanged: number;
  changedOnlyOurs: number;
  changedOnlyTheirs: number;
  changedBoth: number;
  conflicts: number;
}

export interface MergePreviewResult {
  currentBranch: string;
  incomingBranch: string;
  ourHead: string;
  theirHead: string;
  mergeBase: string | null;
  mergeType: MergePreviewKind;
  counts: MergePreviewCounts | null;
  conflicts: MergePreviewConflict[];
  fastForwardFilesUpdated: number | null;
}

function toPreviewConflicts(conflicts: MergeConflict[]): MergePreviewConflict[] {
  return conflicts.map((conflict) => ({
    path: conflict.path,
    kind: conflict.conflictType,
    description: conflictDescription(conflict),
  }));
}

export async function computeMergePreview(
  repo: Repository,
  branchName: string,
): Promise<MergePreviewResult> {
  const { currentBranch, incomingBranch, ourHead, theirHead } =
    await resolveMergeBranches(repo, branchName);

  const ancestryOptions = { rootDir: repo.rootDir };

  if (ourHead === theirHead) {
    return {
      currentBranch,
      incomingBranch,
      ourHead,
      theirHead,
      mergeBase: ourHead,
      mergeType: 'already-up-to-date',
      counts: null,
      conflicts: [],
      fastForwardFilesUpdated: null,
    };
  }

  const alreadyMerged = await isAncestor(
    repo.objectStore,
    theirHead,
    ourHead,
    ancestryOptions,
  );

  if (alreadyMerged) {
    return {
      currentBranch,
      incomingBranch,
      ourHead,
      theirHead,
      mergeBase: theirHead,
      mergeType: 'already-up-to-date',
      counts: null,
      conflicts: [],
      fastForwardFilesUpdated: null,
    };
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

    return {
      currentBranch,
      incomingBranch,
      ourHead,
      theirHead,
      mergeBase: ourHead,
      mergeType: 'fast-forward',
      counts: null,
      conflicts: [],
      fastForwardFilesUpdated: countTreeChanges(ourTree, theirTree),
    };
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

  const treeMerge = await mergeTrees(
    repo.objectStore,
    baseTree,
    ourTree,
    theirTree,
    { currentBranch, incomingBranch },
  );

  return {
    currentBranch,
    incomingBranch,
    ourHead,
    theirHead,
    mergeBase,
    mergeType:
      treeMerge.conflicts.length === 0 ? 'three-way-clean' : 'three-way-conflicts',
    counts: summarizeTreeMerge(treeMerge),
    conflicts: toPreviewConflicts(treeMerge.conflicts),
    fastForwardFilesUpdated: null,
  };
}

function mergeTypeLabel(mergeType: MergePreviewKind): string {
  switch (mergeType) {
    case 'already-up-to-date':
      return 'Already up to date';
    case 'fast-forward':
      return 'Fast-forward';
    case 'three-way-clean':
      return 'Three-way clean merge';
    case 'three-way-conflicts':
      return 'Three-way merge with conflicts';
  }
}

export function formatMergePreview(result: MergePreviewResult): string {
  return formatMergePreviewWithRisk(result, null);
}

export function formatMergePreviewWithRisk(
  result: MergePreviewResult,
  riskReport: string | null,
): string {
  const lines: string[] = [];

  if (riskReport) {
    lines.push(riskReport);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('Merge preview', '');

  lines.push(`Current branch: ${result.currentBranch}`);
  lines.push(`Incoming branch: ${result.incomingBranch}`);

  if (result.mergeBase) {
    lines.push(`Merge base: ${result.mergeBase.slice(0, 7)}`);
  }

  if (result.counts) {
    lines.push('');
    lines.push('Result:');
    lines.push(`  ${result.counts.unchanged} file${result.counts.unchanged === 1 ? '' : 's'} unchanged`);
    lines.push(
      `  ${result.counts.changedOnlyOurs} file${result.counts.changedOnlyOurs === 1 ? '' : 's'} changed only on ${result.currentBranch}`,
    );
    lines.push(
      `  ${result.counts.changedOnlyTheirs} file${result.counts.changedOnlyTheirs === 1 ? '' : 's'} changed only on ${result.incomingBranch}`,
    );
    lines.push(
      `  ${result.counts.changedBoth} file${result.counts.changedBoth === 1 ? '' : 's'} changed on both branches`,
    );
    lines.push(
      `  ${result.counts.conflicts} conflict${result.counts.conflicts === 1 ? '' : 's'} predicted`,
    );
  } else if (result.mergeType === 'fast-forward' && result.fastForwardFilesUpdated !== null) {
    lines.push('');
    lines.push('Result:');
    lines.push(
      `  ${result.fastForwardFilesUpdated} file${result.fastForwardFilesUpdated === 1 ? '' : 's'} would be updated`,
    );
    lines.push('  0 conflicts predicted');
  }

  if (result.conflicts.length > 0) {
    lines.push('');
    lines.push('Potential conflicts:');
    for (const conflict of result.conflicts) {
      lines.push(`  ${conflict.path.padEnd(24)}${conflict.description}`);
    }
  }

  lines.push('');
  lines.push('Merge type:');
  lines.push(`  ${mergeTypeLabel(result.mergeType)}`);

  if (result.mergeType !== 'already-up-to-date') {
    lines.push('');
    lines.push('No files were changed.');
  }

  return lines.join('\n');
}

export async function formatMergePreviewForBranch(
  repo: Repository,
  branchName: string,
  preview: MergePreviewResult,
): Promise<string> {
  const risk = await computeConflictRisk(repo, branchName);
  return formatMergePreviewWithRisk(preview, formatConflictRiskReport(risk));
}
