/**
 * commit-normalize.ts — canonical commit shape and legacy parent migration.
 */

import type { CommitData } from '../types/index.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** On-disk commit before multi-parent support. */
export interface LegacyCommit {
  tree: string;
  parent?: string;
  parents?: string[];
  author: string;
  timestamp: number;
  message: string;
  generation?: number;
}

export type StoredCommitPayload = LegacyCommit | CommitData;

/**
 * normalizeCommit — upgrade legacy `parent` to `parents[]` when reading.
 */
export function normalizeCommit(raw: StoredCommitPayload): CommitData {
  if (Array.isArray(raw.parents)) {
    return {
      tree: raw.tree,
      parents: [...raw.parents],
      author: raw.author,
      timestamp: raw.timestamp,
      message: raw.message,
      ...(raw.generation !== undefined ? { generation: raw.generation } : {}),
    };
  }

  const legacy = raw as LegacyCommit;
  return {
    tree: legacy.tree,
    parents: legacy.parent ? [legacy.parent] : [],
    author: legacy.author,
    timestamp: legacy.timestamp,
    message: legacy.message,
    ...(legacy.generation !== undefined ? { generation: legacy.generation } : {}),
  };
}

/** First parent — the branch tip before this commit (merge: checked-out branch). */
export function getPrimaryParent(commit: CommitData): string | null {
  return commit.parents[0] ?? null;
}

/**
 * computeGeneration — max(parent generation) + 1, or 1 for root commits.
 * Caller must pass already-normalized parent commits when available.
 * Legacy parents without generation are treated as generation 0 before adding 1.
 */
export function computeGeneration(
  parents: string[],
  parentCommits: Array<CommitData | null>,
): number {
  if (parents.length === 0) {
    return 1;
  }

  let maxParentGeneration = 0;
  for (const parent of parentCommits) {
    if (!parent) {
      continue;
    }
    const gen = parent.generation;
    if (gen !== undefined && gen > 0 && gen > maxParentGeneration) {
      maxParentGeneration = gen;
    }
  }

  return maxParentGeneration + 1;
}

/** Canonical JSON payload for new commits (never writes legacy `parent`). */
export function serializeCommit(data: CommitData): CommitData {
  const parents = [...data.parents];

  const commit: CommitData = {
    tree: data.tree,
    parents,
    author: data.author,
    timestamp: data.timestamp,
    message: data.message,
  };

  if (data.generation !== undefined) {
    commit.generation = data.generation;
  }

  return commit;
}

export function validateCommitParents(commit: CommitData): string[] {
  const issues: string[] = [];

  if (!Array.isArray(commit.parents)) {
    issues.push('Commit parents must be an array');
    return issues;
  }

  for (const parent of commit.parents) {
    if (typeof parent !== 'string' || !HASH_PATTERN.test(parent)) {
      issues.push(`Invalid parent hash: ${String(parent)}`);
    }
  }

  return issues;
}
