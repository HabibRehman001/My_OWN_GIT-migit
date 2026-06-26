/**
 * stack-detector.ts — infers project tech stack from config files.
 * What: Detects languages, frameworks, and runtime from package.json/tsconfig.json.
 * How: Checks file existence, parses package.json dependencies for known libs.
 */

import { readFile } from '../utils/file-system.js';
import { existsSync } from '../utils/file-system.js';

/**
 * StackInfo — detected technology stack summary.
 * What: Aggregated languages, frameworks, and runtime for documentation output.
 */
export interface StackInfo {
  languages: string[];
  frameworks: string[];
  runtime: string | null;
}

/**
 * StackDetector — analyzes project root for common stack indicators.
 * What: Powers the "Tech Stack" section in generated documentation.
 */
export class StackDetector {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * detect — scans config files and returns a StackInfo object.
   * What: Heuristic stack detection (Node, React, Express, Mongoose, TypeScript).
   * How:
   *   1. Init empty StackInfo.
   *   2. If package.json exists: mark JS/TS, Node runtime, check deps for frameworks.
   *   3. If tsconfig.json exists: ensure TypeScript is listed in languages.
   */
  async detect(): Promise<StackInfo> {
    const info: StackInfo = {
      languages: [],
      frameworks: [],
      runtime: null,
    };

    if (existsSync(`${this.rootDir}/package.json`)) {
      info.languages.push('JavaScript/TypeScript');
      info.runtime = 'Node.js';
      const pkg = JSON.parse(
        (await readFile(`${this.rootDir}/package.json`)).toString('utf-8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      // Merge prod and dev deps into one lookup object.
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['react']) info.frameworks.push('React');
      if (deps['express']) info.frameworks.push('Express');
      if (deps['mongoose']) info.frameworks.push('Mongoose');
    }

    if (existsSync(`${this.rootDir}/tsconfig.json`)) {
      if (!info.languages.includes('JavaScript/TypeScript')) {
        info.languages.push('TypeScript');
      }
    }

    return info;
  }
}
