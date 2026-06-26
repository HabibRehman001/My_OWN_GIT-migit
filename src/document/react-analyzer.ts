/**
 * react-analyzer.ts — finds React components in .jsx/.tsx files.
 * What: Detects exported function/const components and whether they use hooks.
 * How: Regex on file content after recursively finding component files.
 */

import { readFile } from '../utils/file-system.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * ReactComponent — metadata for one discovered React component.
 * What: Name, source file, and flag indicating React hooks usage.
 */
export interface ReactComponent {
  name: string;
  file: string;
  hasHooks: boolean;
}

/**
 * ReactAnalyzer — static analysis of React component files.
 * What: Powers the "React Components" section in generated documentation.
 */
export class ReactAnalyzer {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * analyze — scans JSX/TSX files and extracts component definitions.
   * What: Returns component name, file path, and hooks detection per component.
   * How:
   *   1. findComponentFiles() collects .jsx/.tsx paths.
   *   2. Regex match for `export function Name` or `export const Name`.
   *   3. Test content for useXxx( pattern to detect hooks.
   */
  async analyze(): Promise<ReactComponent[]> {
    const components: ReactComponent[] = [];
    const files = await this.findComponentFiles(this.rootDir);

    for (const file of files) {
      const content = (await readFile(file)).toString('utf-8');
      const nameMatch = content.match(/(?:export\s+(?:default\s+)?function|const)\s+(\w+)/);
      if (!nameMatch) continue;

      components.push({
        name: nameMatch[1],
        file: file.slice(this.rootDir.length + 1),
        hasHooks: /use[A-Z]\w*\(/.test(content),
      });
    }

    return components;
  }

  /**
   * findComponentFiles — recursively finds .jsx and .tsx files.
   * What: File discovery for React component scanning.
   * How: Same DFS pattern as ExpressAnalyzer, filtered to jsx/tsx extensions.
   */
  private async findComponentFiles(dir: string): Promise<string[]> {
    const result: string[] = [];
    const children = await readdir(dir, { withFileTypes: true });

    for (const child of children) {
      const full = join(dir, child.name);
      if (child.isDirectory() && child.name !== 'node_modules') {
        result.push(...await this.findComponentFiles(full));
      } else if (/\.(jsx|tsx)$/.test(child.name)) {
        result.push(full);
      }
    }

    return result;
  }
}
