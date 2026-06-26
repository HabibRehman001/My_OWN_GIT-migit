/**
 * package-analyzer.ts — extracts metadata from package.json.
 * What: Reads name, version, scripts, and dependency lists for documentation.
 * How: Parses package.json JSON; returns null if file missing or invalid.
 */

import { readFile } from '../utils/file-system.js';
import { join } from 'node:path';

/**
 * PackageAnalysis — structured summary of a Node.js package.json.
 * What: Used in the "Package Info" section of generated docs.
 */
export interface PackageAnalysis {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
}

/**
 * PackageAnalyzer — reads and parses package.json from the project root.
 * What: Provides npm package metadata for documentation generation.
 */
export class PackageAnalyzer {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * analyze — returns parsed package info or null if no valid package.json.
   * What: Safe parser with defaults for missing fields.
   * How:
   *   1. Read package.json from project root.
   *   2. JSON.parse and extract fields with ?? fallbacks.
   *   3. Object.keys on deps objects to get package name lists.
   */
  async analyze(): Promise<PackageAnalysis | null> {
    try {
      const raw = await readFile(join(this.rootDir, 'package.json'));
      const pkg = JSON.parse(raw.toString('utf-8')) as {
        name?: string;
        version?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      return {
        name: pkg.name ?? 'unknown',
        version: pkg.version ?? '0.0.0',
        scripts: pkg.scripts ?? {},
        dependencies: Object.keys(pkg.dependencies ?? {}),
        devDependencies: Object.keys(pkg.devDependencies ?? {}),
      };
    } catch {
      return null;
    }
  }
}
