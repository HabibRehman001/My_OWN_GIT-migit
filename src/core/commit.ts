/**
 * commit.ts — thin helper to create a commit object in the object store.
 * What: Wraps ObjectStore.writeCommit with a clear function name for Repository.
 * How: Passes CommitData through to the object store and returns the new hash.
 */

import type { ObjectStore } from './object-store.js';
import type { CommitData } from '../types/index.js';
import { validateCommitParents } from './commit-normalize.js';

/**
 * createCommit — writes commit metadata to the object store.
 * What: Produces a new commit object linked to a tree and zero or more parents.
 * How: Validates parents[] then delegates to objectStore.writeCommit(data).
 */
export async function createCommit(
  objectStore: ObjectStore,
  data: CommitData,
): Promise<string> {
  const parentIssues = validateCommitParents(data);
  if (parentIssues.length > 0) {
    throw new Error(`Invalid commit parents: ${parentIssues.join('; ')}`);
  }

  return objectStore.writeCommit(data);
}
