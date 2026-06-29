/**
 * merge-state.ts — persists in-progress merge metadata when conflicts block completion.
 */

import type { MergeConflict, MergeConflictType } from './merge-types.js';
import { getMergeMsgPath, getMergeStatePath } from '../../utils/paths.js';
import { readFile, existsSync } from '../../utils/file-system.js';
import { atomicWrite } from '../../utils/atomic-write.js';
import { MiGitError } from '../../utils/errors.js';

export const MERGE_STATE_VERSION = 1;

export interface MergeStateConflict {
  path: string;
  type: MergeConflictType;
  baseHash?: string;
  ourHash?: string;
  theirHash?: string;
  resolved: boolean;
}

export interface MergeState {
  version: number;
  currentBranch: string;
  incomingBranch: string;
  baseCommit: string;
  ourCommit: string;
  theirCommit: string;
  startedAt: string;
  conflicts: MergeStateConflict[];
}

export function formatMergeMessage(incomingBranch: string, currentBranch: string): string {
  return `Merge branch ${incomingBranch} into ${currentBranch}`;
}

export function mergeConflictsToStateConflicts(
  conflicts: MergeConflict[],
): MergeStateConflict[] {
  return conflicts.map((conflict) => ({
    path: conflict.path,
    type: conflict.conflictType,
    baseHash: conflict.baseHash,
    ourHash: conflict.ourHash,
    theirHash: conflict.theirHash,
    resolved: false,
  }));
}

export function isMergeInProgress(rootDir: string): boolean {
  return existsSync(getMergeStatePath(rootDir));
}

export async function loadMergeState(rootDir: string): Promise<MergeState | null> {
  const path = getMergeStatePath(rootDir);
  try {
    const raw = await readFile(path);
    return JSON.parse(raw.toString('utf8')) as MergeState;
  } catch {
    return null;
  }
}

export async function saveMergeState(rootDir: string, state: MergeState): Promise<void> {
  await atomicWrite(getMergeStatePath(rootDir), JSON.stringify(state, null, 2));
}

export async function saveMergeMsg(rootDir: string, message: string): Promise<void> {
  await atomicWrite(getMergeMsgPath(rootDir), `${message}\n`);
}

export async function clearMergeState(rootDir: string): Promise<void> {
  const { unlink } = await import('../../utils/file-system.js');
  await unlink(getMergeStatePath(rootDir)).catch(() => {});
  await unlink(getMergeMsgPath(rootDir)).catch(() => {});
}

export async function loadMergeMessage(rootDir: string): Promise<string> {
  try {
    const raw = await readFile(getMergeMsgPath(rootDir));
    const message = raw.toString('utf8').replace(/\s+$/, '');
    if (!message) {
      throw new MiGitError('Merge stopped: .migit/MERGE_MSG is empty.');
    }
    return message;
  } catch (error) {
    if (error instanceof MiGitError) {
      throw error;
    }
    throw new MiGitError('Merge stopped: missing .migit/MERGE_MSG.');
  }
}

export async function requireMergeState(
  rootDir: string,
  verb: 'Merge' | 'Resolve' = 'Merge',
): Promise<MergeState> {
  const state = await loadMergeState(rootDir);
  if (!state) {
    throw new MiGitError(`${verb} stopped: no merge is in progress.`);
  }
  return state;
}
