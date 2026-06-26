/**
 * staged-changes.ts — builds ChangeSummary from HEAD ↔ index staged diffs.
 */

import type { Repository } from '../core/repository.js';
import { listCommitFiles } from '../core/commit-files.js';
import { loadHeadSnapshot } from '../core/snapshot.js';
import {
  buildChangeSummary,
  type ChangeSummary,
  type FileChangeSummary,
} from './change-summary.js';
import {
  buildDiffSample,
  computeLineDiff,
  isBinaryContent,
  summarizeLineChanges,
} from './diff-redactor.js';
import { isSensitiveFile } from '../utils/ignore.js';

export async function buildStagedChangeSummary(repo: Repository): Promise<ChangeSummary> {
  repo.assertInitialized();

  const index = await repo.indexStore.load();
  if (index.length === 0) {
    throw new Error('Nothing staged — run "migit add" first');
  }

  const indexMap = new Map(index.map((entry) => [entry.path, entry.hash]));
  const headMap = await loadHeadSnapshot(
    repo.objectStore,
    await repo.refs.getHead(),
  );

  const stagedChanges = await listCommitFiles(repo);
  const stagedPaths = new Set(stagedChanges.map((change) => change.path));

  const files: FileChangeSummary[] = [];

  for (const path of [...stagedPaths].sort()) {
    if (isSensitiveFile(path)) {
      continue;
    }

    const headHash = headMap.get(path);
    const indexHash = indexMap.get(path);

    let changeType: FileChangeSummary['changeType'];
    if (!headHash) {
      changeType = 'added';
    } else if (!indexHash) {
      changeType = 'deleted';
    } else {
      changeType = 'modified';
    }

    files.push(await summarizeFile(repo, path, changeType, headHash, indexHash));
  }

  if (files.length === 0) {
    throw new Error(
      'No analyzable staged changes — sensitive files like .env are excluded from smart commit',
    );
  }

  return buildChangeSummary(files);
}

async function summarizeFile(
  repo: Repository,
  path: string,
  changeType: FileChangeSummary['changeType'],
  headHash: string | undefined,
  indexHash: string | undefined,
): Promise<FileChangeSummary> {
  if (changeType === 'deleted') {
    const content = await repo.objectStore.readBlob(headHash!);
    if (isBinaryContent(content)) {
      return {
        path,
        changeType,
        addedLines: 0,
        deletedLines: 0,
        summary: ['Removed binary file'],
      };
    }

    const lines = content.toString('utf8').split('\n').length;
    return {
      path,
      changeType,
      addedLines: 0,
      deletedLines: lines,
      summary: ['Removed file'],
      diffSample: [`- [deleted file, ${lines} lines]`],
    };
  }

  const newContent = await repo.objectStore.readBlob(indexHash!);
  if (isBinaryContent(newContent)) {
    return {
      path,
      changeType,
      addedLines: 0,
      deletedLines: 0,
      summary: [changeType === 'added' ? 'Added binary file' : 'Updated binary file'],
    };
  }

  const newText = newContent.toString('utf8');

  if (changeType === 'added') {
    const added = newText.split('\n');
    const summary = summarizeLineChanges(added, []);
    return {
      path,
      changeType,
      addedLines: added.length,
      deletedLines: 0,
      summary: summary.length > 0 ? summary : ['Added new file'],
      diffSample: buildDiffSample([], added.slice(0, 8)),
    };
  }

  const oldContent = await repo.objectStore.readBlob(headHash!);
  const oldText = isBinaryContent(oldContent) ? '' : oldContent.toString('utf8');
  const diff = computeLineDiff(oldText, newText);
  const summary = summarizeLineChanges(diff.added, diff.removed);

  return {
    path,
    changeType,
    addedLines: diff.addedLines,
    deletedLines: diff.deletedLines,
    summary: summary.length > 0 ? summary : ['Modified file content'],
    diffSample: buildDiffSample(diff.removed, diff.added),
  };
}
