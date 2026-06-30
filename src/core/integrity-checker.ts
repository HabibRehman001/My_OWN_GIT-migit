/**
 * integrity-checker.ts — deep repository health checks for `migit doctor`.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repository } from './repository.js';
import type { StoredObjectRecord } from './object-store.js';
import { isValidObjectHash } from './object-store.js';
import type { CommitData, StagedEntry } from '../types/index.js';
import { normalizeCommit, validateCommitParents } from './commit-normalize.js';
import {
  getBranchRefPath,
  getHeadFilePath,
  getMiGitDir,
  getIndexPath,
} from '../utils/paths.js';
import { existsSync, readFile } from '../utils/file-system.js';
import { resolveBranchStandards, branchStandardsIssue } from '../utils/branch-standards.js';
import { branchPolicyIssue } from '../utils/branch-policy.js';

const HEAD_REF_PATTERN = /^ref: refs\/heads\/([^\s]+)$/;
const ALLOWED_TOP_LEVEL = new Set([
  'HEAD',
  'MERGE_MSG',
  'cache',
  'config.json',
  'history.log',
  'index',
  'merge-state.json',
  'objects',
  'ownership.json',
  'policy.json',
  'refs',
  'locks',
]);

export class IntegrityChecker {
  constructor(private readonly repo: Repository) {}

  async run(): Promise<string[]> {
    const issues: string[] = [];

    issues.push(...this.repo.configStore.verify());
    issues.push(...this.repo.policyStore.verify());
    issues.push(...this.repo.ownershipStore.verify());
    issues.push(...(await this.verifyHeadAndBranches()));
    issues.push(...(await this.verifyBranchStandards()));
    issues.push(...(await this.verifyBranchPolicy()));

    const storage = await this.repo.objectStore.verifyStorage();
    issues.push(...storage.issues);

    issues.push(...(await this.verifyCommitGraph(storage.objects)));
    issues.push(...(await this.verifyIndex(storage.objects)));
    issues.push(...(await this.findTemporaryMetadataFiles()));

    return issues;
  }

  private async verifyHeadAndBranches(): Promise<string[]> {
    const issues: string[] = [];
    const headPath = getHeadFilePath(this.repo.rootDir);

    if (!existsSync(headPath)) {
      issues.push('Missing .migit/HEAD file');
      return issues;
    }

    let headContent: string;
    try {
      headContent = (await readFile(headPath)).toString('utf8').trim();
    } catch {
      issues.push('Unreadable .migit/HEAD file');
      return issues;
    }

    const headMatch = headContent.match(HEAD_REF_PATTERN);
    if (!headMatch) {
      issues.push('Invalid .migit/HEAD format (expected: ref: refs/heads/<branch>)');
      return issues;
    }

    const currentBranch = headMatch[1];
    const branchPath = getBranchRefPath(this.repo.rootDir, currentBranch);
    if (!existsSync(branchPath)) {
      issues.push(`HEAD points to missing branch ref: refs/heads/${currentBranch}`);
    }

    const branches = await this.repo.refs.listBranches();
    if (branches.length === 0) {
      issues.push('No branch refs found in .migit/refs/heads/');
      return issues;
    }

    for (const branch of branches) {
      const refPath = getBranchRefPath(this.repo.rootDir, branch);
      if (!existsSync(refPath)) {
        issues.push(`Missing branch ref file for ${branch}`);
        continue;
      }

      let hash: string;
      try {
        hash = (await readFile(refPath)).toString('utf8').trim();
      } catch {
        issues.push(`Unreadable branch ref: refs/heads/${branch}`);
        continue;
      }

      if (!hash) {
        issues.push(`Branch refs/heads/${branch} is empty`);
        continue;
      }

      if (!isValidObjectHash(hash)) {
        issues.push(`Branch refs/heads/${branch} points to invalid hash: ${hash}`);
      }
    }

    return issues;
  }

  private async verifyBranchStandards(): Promise<string[]> {
    const config = await this.repo.configStore.load();
    const standards = resolveBranchStandards(config);
    if (!standards.enabled) {
      return [];
    }

    const issues: string[] = [];
    for (const branch of await this.repo.refs.listBranches()) {
      const message = branchStandardsIssue(branch, standards);
      if (message) {
        issues.push(`Branch "${branch}" violates naming standards: ${message}`);
      }
    }

    return issues;
  }

  private async verifyBranchPolicy(): Promise<string[]> {
    const policy = await this.repo.policyStore.load();
    const issues: string[] = [];

    for (const branch of await this.repo.refs.listBranches()) {
      const message = branchPolicyIssue(branch, policy);
      if (message) {
        issues.push(`Branch "${branch}" violates policy: ${message}`);
      }
    }

    return issues;
  }

  private async verifyCommitGraph(objects: Map<string, StoredObjectRecord>): Promise<string[]> {
    const issues: string[] = [];
    const visited = new Set<string>();
    const branchTips: string[] = [];

    for (const branch of await this.repo.refs.listBranches()) {
      const hash = await this.repo.refs.readBranch(branch);
      if (hash) {
        branchTips.push(hash);
      }
    }

    for (const tip of new Set(branchTips)) {
      issues.push(...this.walkCommitChain(tip, objects, visited));
    }

    return issues;
  }

  private walkCommitChain(
    startHash: string,
    objects: Map<string, StoredObjectRecord>,
    visited: Set<string>,
  ): string[] {
    const issues: string[] = [];
    const stack: string[] = [startHash];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (!isValidObjectHash(current)) {
        issues.push(`Invalid commit hash in chain: ${current}`);
        continue;
      }

      const object = objects.get(current);
      if (!object) {
        issues.push(`Missing commit object: ${current}`);
        continue;
      }

      if (object.type !== 'commit') {
        issues.push(`Reference ${current} is not a commit object (found ${object.type})`);
        continue;
      }

      let commit: CommitData;
      try {
        commit = normalizeCommit(JSON.parse(object.payload.toString('utf8')));
      } catch {
        issues.push(`Commit ${current} contains invalid JSON`);
        continue;
      }

      if (!commit.tree || typeof commit.tree !== 'string') {
        issues.push(`Commit ${current} is missing a tree reference`);
        continue;
      }

      if (!isValidObjectHash(commit.tree)) {
        issues.push(`Commit ${current} has invalid tree hash: ${commit.tree}`);
        continue;
      }

      issues.push(...this.verifyTree(commit.tree, objects, current));
      issues.push(...validateCommitParents(commit).map((issue) => `Commit ${current}: ${issue}`));

      for (const parentHash of commit.parents) {
        issues.push(...this.verifyCommitExists(parentHash, objects, current));
        stack.push(parentHash);
      }
    }

    return issues;
  }

  private verifyCommitExists(
    parentHash: string,
    objects: Map<string, StoredObjectRecord>,
    commitHash: string,
  ): string[] {
    const issues: string[] = [];

    if (!isValidObjectHash(parentHash)) {
      issues.push(`Commit ${commitHash} references invalid parent hash: ${parentHash}`);
      return issues;
    }

    const parentObject = objects.get(parentHash);
    if (!parentObject) {
      issues.push(`Commit ${commitHash} references missing parent object ${parentHash}`);
      return issues;
    }

    if (parentObject.type !== 'commit') {
      issues.push(
        `Commit ${commitHash} parent ${parentHash} is not a commit object (found ${parentObject.type})`,
      );
    }

    return issues;
  }

  private verifyTree(
    treeHash: string,
    objects: Map<string, StoredObjectRecord>,
    commitHash: string,
  ): string[] {
    const issues: string[] = [];
    const treeObject = objects.get(treeHash);

    if (!treeObject) {
      issues.push(`Commit ${commitHash} references missing tree object ${treeHash}`);
      return issues;
    }

    if (treeObject.type !== 'tree') {
      issues.push(`Tree ${treeHash} referenced by commit ${commitHash} is not stored as a tree object`);
      return issues;
    }

    let tree: unknown;
    try {
      tree = JSON.parse(treeObject.payload.toString('utf8'));
    } catch {
      issues.push(`Tree ${treeHash} referenced by commit ${commitHash} contains invalid JSON`);
      return issues;
    }

    if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) {
      issues.push(`Tree ${treeHash} must be a JSON object map`);
      return issues;
    }

    for (const [path, blobHash] of Object.entries(tree as Record<string, unknown>)) {
      if (typeof blobHash !== 'string') {
        issues.push(`Tree ${treeHash} entry "${path}" is not a string hash`);
        continue;
      }

      if (!isValidObjectHash(blobHash)) {
        issues.push(`Tree ${treeHash} entry "${path}" has invalid blob hash: ${blobHash}`);
        continue;
      }

      const blob = objects.get(blobHash);
      if (!blob) {
        issues.push(`Tree ${treeHash} references missing blob ${blobHash} at path "${path}"`);
        continue;
      }

      if (blob.type !== 'blob') {
        issues.push(`Tree ${treeHash} path "${path}" points to non-blob object ${blobHash}`);
      }
    }

    return issues;
  }

  private async verifyIndex(objects: Map<string, StoredObjectRecord>): Promise<string[]> {
    const issues: string[] = [];
    const indexPath = getIndexPath(this.repo.rootDir);

    if (!existsSync(indexPath)) {
      issues.push('Missing .migit/index file');
      return issues;
    }

    let raw: Buffer;
    try {
      raw = await readFile(indexPath);
    } catch {
      issues.push('Unreadable .migit/index file');
      return issues;
    }

    let entries: unknown;
    try {
      entries = JSON.parse(raw.toString('utf8'));
    } catch {
      issues.push('Invalid index JSON');
      return issues;
    }

    if (!Array.isArray(entries)) {
      issues.push('Index must be a JSON array');
      return issues;
    }

    for (const [index, entry] of entries.entries()) {
      if (!this.isStagedEntry(entry)) {
        issues.push(`Invalid index entry at position ${index}`);
        continue;
      }

      if (!isValidObjectHash(entry.hash)) {
        issues.push(`Index entry "${entry.path}" has invalid object hash: ${entry.hash}`);
        continue;
      }

      const object = objects.get(entry.hash);
      if (!object) {
        issues.push(`Index entry "${entry.path}" references missing object ${entry.hash}`);
        continue;
      }

      if (object.type !== 'blob') {
        issues.push(`Index entry "${entry.path}" references non-blob object ${entry.hash}`);
      }
    }

    return issues;
  }

  private isStagedEntry(entry: unknown): entry is StagedEntry {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const candidate = entry as Partial<StagedEntry>;
    return (
      typeof candidate.path === 'string' &&
      typeof candidate.hash === 'string' &&
      typeof candidate.mode === 'string'
    );
  }

  private async findTemporaryMetadataFiles(): Promise<string[]> {
    const issues: string[] = [];
    const migitDir = getMiGitDir(this.repo.rootDir);

    await this.walkMiGitDir(migitDir, async (relativePath, isDirectory) => {
      if (relativePath === '') {
        return;
      }

      const name = relativePath.split('/').pop() ?? relativePath;

      if (isDirectory) {
        const top = relativePath.split('/')[0];
        if (top === 'objects' || top === 'refs') {
          return;
        }
        if (!ALLOWED_TOP_LEVEL.has(relativePath)) {
          issues.push(`Unexpected metadata directory: .migit/${relativePath}`);
        }
        return;
      }

      if (name.endsWith('.tmp') || /^\..+\.tmp$/.test(name)) {
        issues.push(`Temporary metadata file remains: .migit/${relativePath}`);
        return;
      }

      if (!relativePath.includes('/')) {
        if (!ALLOWED_TOP_LEVEL.has(relativePath)) {
          issues.push(`Unexpected metadata file: .migit/${relativePath}`);
        }
        return;
      }

      const [top, second] = relativePath.split('/');
      if (top === 'objects') {
        return;
      }
      if (top === 'refs' && second === 'heads') {
        return;
      }
      if (top === 'cache' && second === 'commit-generations.json') {
        return;
      }
      if (top === 'locks' && second === 'repository.lock') {
        return;
      }

      issues.push(`Unexpected metadata file: .migit/${relativePath}`);
    });

    return issues;
  }

  private async walkMiGitDir(
    root: string,
    visitor: (relativePath: string, isDirectory: boolean) => Promise<void>,
  ): Promise<void> {
    async function walk(current: string, prefix: string): Promise<void> {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        await visitor(rel, entry.isDirectory());
        if (entry.isDirectory()) {
          await walk(join(current, entry.name), rel);
        }
      }
    }

    await walk(root, '');
  }
}
