/**
 * content-merge.ts — load blob bodies only for dual-change conflict candidates.
 */

import type { ObjectStore } from '../object-store.js';
import type {
  FileMergeResult,
  LineConflict,
  TextFileMergeInput,
} from './merge-types.js';

export type { FileMergeResult, LineConflict, TextFileMergeInput };

export function isBinaryContent(content: Buffer): boolean {
  return content.includes(0);
}

interface ReplaceRegion {
  baseStart: number;
  baseEnd: number;
  sideLines: string[];
}

function nextMatchingLine(
  base: string[],
  side: string[],
  baseIndex: number,
  sideIndex: number,
): { baseIndex: number; sideIndex: number } | null {
  for (let i = baseIndex; i < base.length; i++) {
    for (let j = sideIndex; j < side.length; j++) {
      if (base[i] === side[j]) {
        return { baseIndex: i, sideIndex: j };
      }
    }
  }
  return null;
}

/** Regions of base lines replaced when transforming base → side. */
export function diffReplaceRegions(base: string[], side: string[]): ReplaceRegion[] {
  if (base.length === 0 && side.length === 0) {
    return [];
  }

  if (base.length === 0) {
    return [{ baseStart: 0, baseEnd: 0, sideLines: [...side] }];
  }

  const regions: ReplaceRegion[] = [];
  let baseIndex = 0;
  let sideIndex = 0;

  while (baseIndex < base.length || sideIndex < side.length) {
    while (
      baseIndex < base.length &&
      sideIndex < side.length &&
      base[baseIndex] === side[sideIndex]
    ) {
      baseIndex++;
      sideIndex++;
    }

    if (baseIndex >= base.length && sideIndex >= side.length) {
      break;
    }

    const baseStart = baseIndex;
    const sideStart = sideIndex;
    const match = nextMatchingLine(base, side, baseIndex, sideIndex);

    if (match) {
      regions.push({
        baseStart,
        baseEnd: match.baseIndex,
        sideLines: side.slice(sideStart, match.sideIndex),
      });
      baseIndex = match.baseIndex;
      sideIndex = match.sideIndex;
      continue;
    }

    regions.push({
      baseStart,
      baseEnd: base.length,
      sideLines: side.slice(sideStart),
    });
    break;
  }

  return regions.filter(
    (region) => region.baseEnd > region.baseStart || region.sideLines.length > 0,
  );
}

function regionsOverlap(a: ReplaceRegion, b: ReplaceRegion): boolean {
  return a.baseStart < b.baseEnd && b.baseStart < a.baseEnd;
}

function regionsEquivalent(a: ReplaceRegion, b: ReplaceRegion): boolean {
  if (a.sideLines.length !== b.sideLines.length) {
    return false;
  }
  for (let i = 0; i < a.sideLines.length; i++) {
    if (a.sideLines[i] !== b.sideLines[i]) {
      return false;
    }
  }
  return true;
}

function toLineConflict(
  baseLines: string[],
  ourRegion: ReplaceRegion,
  theirRegion: ReplaceRegion,
): LineConflict {
  const baseStart = Math.min(ourRegion.baseStart, theirRegion.baseStart);
  const baseEnd = Math.max(ourRegion.baseEnd, theirRegion.baseEnd);

  return {
    startLine: baseStart + 1,
    endLine: baseEnd + 1,
    baseLines: baseLines.slice(baseStart, baseEnd),
    ourLines: ourRegion.sideLines,
    theirLines: theirRegion.sideLines,
  };
}

function conflictKey(conflict: LineConflict): string {
  return `${conflict.startLine}:${conflict.endLine}`;
}

const DEFAULT_CURRENT_BRANCH = 'main';
const DEFAULT_INCOMING_BRANCH = 'branch';

function lineConflictOverlapsRegion(conflict: LineConflict, region: ReplaceRegion): boolean {
  const start = conflict.startLine - 1;
  const end = conflict.endLine - 1;
  return region.baseStart < end && start < region.baseEnd;
}

/** Format a single conflict region with current / base / incoming markers. */
export function formatConflictBlock(
  conflict: LineConflict,
  currentBranch: string,
  incomingBranch: string,
): string[] {
  return [
    `<<<<<<< current:${currentBranch}`,
    ...conflict.ourLines,
    '||||||| base',
    ...conflict.baseLines,
    '=======',
    ...conflict.theirLines,
    `>>>>>>> incoming:${incomingBranch}`,
  ];
}

function buildMarkedMergeContent(
  baseLines: string[],
  ourRegions: ReplaceRegion[],
  theirRegions: ReplaceRegion[],
  conflicts: LineConflict[],
  currentBranch: string,
  incomingBranch: string,
): string {
  const sortedConflicts = [...conflicts].sort((a, b) => a.startLine - b.startLine);
  const applicableRegions = [...ourRegions, ...theirRegions].filter(
    (region) => !conflicts.some((conflict) => lineConflictOverlapsRegion(conflict, region)),
  );
  const regionByStart = new Map<number, ReplaceRegion>();
  for (const region of applicableRegions) {
    regionByStart.set(region.baseStart, region);
  }

  const output: string[] = [];
  let index = 0;

  while (index < baseLines.length) {
    const conflict = sortedConflicts.find((entry) => entry.startLine - 1 === index);
    if (conflict) {
      output.push(...formatConflictBlock(conflict, currentBranch, incomingBranch));
      index = conflict.endLine - 1;
      continue;
    }

    const region = regionByStart.get(index);
    if (region) {
      output.push(...region.sideLines);
      index = region.baseEnd;
      continue;
    }

    output.push(baseLines[index]!);
    index++;
  }

  return output.join('\n');
}

/**
 * mergeTextFile — line-based diff3-style three-way text merge.
 * Combines non-overlapping edits; reports LineConflict when the same base lines
 * were changed differently on both branches.
 */
export function mergeTextFile(input: TextFileMergeInput): FileMergeResult {
  const baseLines = input.base.split('\n');
  const ourLines = input.ours.split('\n');
  const theirLines = input.theirs.split('\n');

  if (input.ours === input.theirs) {
    return {
      clean: true,
      content: Buffer.from(input.ours, 'utf8'),
      conflicts: [],
    };
  }

  if (input.ours === input.base) {
    return {
      clean: true,
      content: Buffer.from(input.theirs, 'utf8'),
      conflicts: [],
    };
  }

  if (input.theirs === input.base) {
    return {
      clean: true,
      content: Buffer.from(input.ours, 'utf8'),
      conflicts: [],
    };
  }

  const ourRegions = diffReplaceRegions(baseLines, ourLines);
  const theirRegions = diffReplaceRegions(baseLines, theirLines);
  const conflicts: LineConflict[] = [];
  const seenConflicts = new Set<string>();

  for (const ourRegion of ourRegions) {
    for (const theirRegion of theirRegions) {
      if (!regionsOverlap(ourRegion, theirRegion)) {
        continue;
      }
      if (regionsEquivalent(ourRegion, theirRegion)) {
        continue;
      }

      const conflict = toLineConflict(baseLines, ourRegion, theirRegion);
      const key = conflictKey(conflict);
      if (!seenConflicts.has(key)) {
        seenConflicts.add(key);
        conflicts.push(conflict);
      }
    }
  }

  if (conflicts.length > 0) {
    const currentBranch = input.currentBranch ?? DEFAULT_CURRENT_BRANCH;
    const incomingBranch = input.incomingBranch ?? DEFAULT_INCOMING_BRANCH;
    const markedContent = buildMarkedMergeContent(
      baseLines,
      ourRegions,
      theirRegions,
      conflicts,
      currentBranch,
      incomingBranch,
    );

    return {
      clean: false,
      content: Buffer.from(markedContent, 'utf8'),
      conflicts,
    };
  }

  const applied = new Map<string, ReplaceRegion>();
  for (const region of [...ourRegions, ...theirRegions]) {
    applied.set(`${region.baseStart}:${region.baseEnd}`, region);
  }

  const mergedLines = [...baseLines];
  const mergedRegions = [...applied.values()].sort((a, b) => b.baseStart - a.baseStart);

  for (const region of mergedRegions) {
    mergedLines.splice(
      region.baseStart,
      region.baseEnd - region.baseStart,
      ...region.sideLines,
    );
  }

  return {
    clean: true,
    content: Buffer.from(mergedLines.join('\n'), 'utf8'),
    conflicts: [],
  };
}

/** @deprecated Use mergeTextFile — returns merged text or null on conflict. */
export function mergeThreeWayText(base: string, ours: string, theirs: string): string | null {
  const result = mergeTextFile({ base, ours, theirs });
  return result.clean ? result.content.toString('utf8') : null;
}

export interface ContentMergeOptions {
  currentBranch?: string;
  incomingBranch?: string;
}

/**
 * mergeContentCandidate — load BASE/OURS/THEIRS blobs only for dual-change paths.
 */
export async function mergeContentCandidate(
  objectStore: ObjectStore,
  baseHash: string | undefined,
  ourHash: string,
  theirHash: string,
  options?: ContentMergeOptions,
): Promise<ContentMergeOutcome> {
  const [baseContent, ourContent, theirContent] = await Promise.all([
    baseHash ? objectStore.readBlob(baseHash) : Promise.resolve(Buffer.alloc(0)),
    objectStore.readBlob(ourHash),
    objectStore.readBlob(theirHash),
  ]);

  if (
    isBinaryContent(baseContent) ||
    isBinaryContent(ourContent) ||
    isBinaryContent(theirContent)
  ) {
    return { status: 'conflict', conflictType: 'binary' };
  }

  const fileResult = mergeTextFile({
    base: baseContent.toString('utf8'),
    ours: ourContent.toString('utf8'),
    theirs: theirContent.toString('utf8'),
    currentBranch: options?.currentBranch,
    incomingBranch: options?.incomingBranch,
  });

  if (!fileResult.clean) {
    return {
      status: 'conflict',
      conflictType: 'content',
      content: fileResult.content,
    };
  }

  return { status: 'merged', content: fileResult.content };
}

export type ContentMergeOutcome =
  | { status: 'merged'; content: Buffer }
  | { status: 'conflict'; conflictType: 'content' | 'binary'; content?: Buffer };
