/**
 * commit-files.ts — paths that differ between HEAD and the index (this commit's contents).
 */

import type { Repository } from './repository.js';
import { loadHeadSnapshot } from './snapshot.js';

export type CommitFileChangeType = 'added' | 'modified' | 'deleted';

export interface CommitFileChange {
  path: string;
  changeType: CommitFileChangeType;
}

/** Files included in the next commit: index entries that differ from HEAD. */
export async function listCommitFiles(repo: Repository): Promise<CommitFileChange[]> {
  repo.assertInitialized();

  const index = await repo.indexStore.load();
  const indexMap = new Map(index.map((entry) => [entry.path, entry.hash]));
  const headMap = await loadHeadSnapshot(
    repo.objectStore,
    await repo.refs.getHead(),
  );

  const changes: CommitFileChange[] = [];

  for (const path of new Set([...indexMap.keys(), ...headMap.keys()])) {
    const headHash = headMap.get(path);
    const indexHash = indexMap.get(path);
    if (headHash === indexHash) {
      continue;
    }

    if (!headHash) {
      changes.push({ path, changeType: 'added' });
    } else if (!indexHash) {
      changes.push({ path, changeType: 'deleted' });
    } else {
      changes.push({ path, changeType: 'modified' });
    }
  }

  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

const CHANGE_LABELS: Record<CommitFileChangeType, string> = {
  added: 'new file',
  modified: 'modified',
  deleted: 'deleted',
};

export function formatCommitFileChange(change: CommitFileChange): string {
  return `  ${CHANGE_LABELS[change.changeType]}: ${change.path}`;
}
