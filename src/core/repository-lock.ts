/**
 * repository-lock.ts — exclusive repository lock via atomic file creation.
 */

import { open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getRepositoryLockPath } from '../utils/paths.js';
import { ensureDir, existsSync, readFile } from '../utils/file-system.js';
import { MiGitError } from '../utils/errors.js';

export interface RepositoryLockInfo {
  pid: number;
  operation: string;
  startedAt: string;
}

export function isRepositoryLocked(rootDir: string): boolean {
  return existsSync(getRepositoryLockPath(rootDir));
}

export async function readRepositoryLock(rootDir: string): Promise<RepositoryLockInfo | null> {
  const lockPath = getRepositoryLockPath(rootDir);
  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const raw = await readFile(lockPath);
    return JSON.parse(raw.toString('utf8')) as RepositoryLockInfo;
  } catch {
    return null;
  }
}

function formatLockHeldMessage(info: RepositoryLockInfo | null): string {
  if (!info) {
    return 'Repository is locked by another MiGit operation.';
  }

  return (
    `Repository is locked by another MiGit operation (${info.operation}, pid ${info.pid}, started ${info.startedAt}).`
  );
}

export function assertRepositoryUnlocked(rootDir: string): void {
  if (!isRepositoryLocked(rootDir)) {
    return;
  }

  throw new MiGitError(formatLockHeldMessage(null));
}

export async function assertRepositoryUnlockedAsync(rootDir: string): Promise<void> {
  if (!isRepositoryLocked(rootDir)) {
    return;
  }

  const info = await readRepositoryLock(rootDir);
  throw new MiGitError(formatLockHeldMessage(info));
}

export class RepositoryLock {
  private acquired = false;

  constructor(
    private readonly rootDir: string,
    private readonly operation: string,
  ) {}

  async acquire(): Promise<void> {
    if (this.acquired) {
      return;
    }

    const lockPath = getRepositoryLockPath(this.rootDir);
    await ensureDir(dirname(lockPath));

    const payload: RepositoryLockInfo = {
      pid: process.pid,
      operation: this.operation,
      startedAt: new Date().toISOString(),
    };

    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(payload, null, 2));
      } finally {
        await handle.close();
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') {
        const info = await readRepositoryLock(this.rootDir);
        throw new MiGitError(formatLockHeldMessage(info));
      }
      throw error;
    }

    this.acquired = true;
  }

  async release(): Promise<void> {
    if (!this.acquired) {
      return;
    }

    await releaseRepositoryLock(this.rootDir);
    this.acquired = false;
  }
}

export function createRepositoryLock(rootDir: string, operation: string): RepositoryLock {
  return new RepositoryLock(rootDir, operation);
}

export async function releaseRepositoryLock(rootDir: string): Promise<void> {
  await rm(getRepositoryLockPath(rootDir), { force: true });
}
