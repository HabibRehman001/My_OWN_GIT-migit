/**
 * project-scanner.ts — recursively lists all project files with extensions.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IgnoreRules } from '../utils/ignore-rules.js';
import { isPermissionDenied } from '../utils/walk-options.js';
import { toRepositoryRelativePath } from '../utils/path-guard.js';

export interface ProjectFile {
  path: string;
  extension: string;
}

export class ProjectScanner {
  constructor(private readonly rootDir: string = process.cwd()) {}

  async scan(): Promise<ProjectFile[]> {
    const files: ProjectFile[] = [];
    const ignoreRules = await IgnoreRules.load(this.rootDir);
    await this.walk(this.rootDir, ignoreRules, files);
    return files;
  }

  private async walk(
    dir: string,
    ignoreRules: IgnoreRules,
    files: ProjectFile[],
  ): Promise<void> {
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isPermissionDenied(error)) {
        return;
      }
      throw error;
    }

    for (const child of children) {
      const full = join(dir, child.name);
      let rel: string;
      try {
        rel = toRepositoryRelativePath(this.rootDir, full);
      } catch {
        continue;
      }

      if (child.isSymbolicLink()) {
        continue;
      }

      if (ignoreRules.isIgnored(rel, child.isDirectory())) {
        continue;
      }

      if (child.isDirectory()) {
        await this.walk(full, ignoreRules, files);
      } else {
        const ext = child.name.includes('.') ? child.name.split('.').pop() ?? '' : '';
        files.push({ path: rel, extension: ext });
      }
    }
  }
}
