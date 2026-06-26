/**
 * commit.ts — thin helper to create a commit object in the object store.
 * What: Wraps ObjectStore.writeCommit with a clear function name for Repository.
 * How: Passes CommitData through to the object store and returns the new hash.
 */

import type { ObjectStore } from './object-store.js';
import type { CommitData } from '../types/index.js';

/**
 * createCommit — writes commit metadata to the object store.
 * What: Produces a new commit object linked to a tree and optional parent.
 * How: Delegates entirely to objectStore.writeCommit(data).
 */
export async function createCommit(
  objectStore: ObjectStore,
  data: CommitData,
): Promise<string> {
  return objectStore.writeCommit(data);
}
