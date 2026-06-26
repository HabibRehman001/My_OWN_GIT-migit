/**
 * express-analyzer.ts — finds Express HTTP routes by scanning source code.
 * What: Detects .get(), .post(), .put(), .delete() route definitions in JS/TS files.
 * How: Regex patterns on file content after recursively finding all .js/.ts files.
 */

import { readFile } from '../utils/file-system.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * ExpressRoute — one discovered HTTP endpoint.
 * What: Records HTTP method, URL path, and which source file defines it.
 */
export interface ExpressRoute {
  method: string;
  path: string;
  file: string;
}

/**
 * ExpressAnalyzer — static analysis of Express route registrations.
 * What: Powers the "Express Routes" section in generated documentation.
 */
export class ExpressAnalyzer {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * analyze — scans all JS/TS files and extracts Express route definitions.
   * What: Returns an array of method + path + file for each matched route.
   * How:
   *   1. findJsFiles() recursively collects source files.
   *   2. For each file: read content, run 4 regex patterns (GET/POST/PUT/DELETE).
   *   3. forEach over patterns with while loop to find all matches per pattern.
   */
  async analyze(): Promise<ExpressRoute[]> {
    const routes: ExpressRoute[] = [];
    const files = await this.findJsFiles(this.rootDir);

    for (const file of files) {
      const content = (await readFile(file)).toString('utf-8');
      // Regex patterns for Express route methods — capture group 1 = URL path.
      const patterns = [
        /\.get\(['"`]([^'"`]+)['"`]/g,
        /\.post\(['"`]([^'"`]+)['"`]/g,
        /\.put\(['"`]([^'"`]+)['"`]/g,
        /\.delete\(['"`]([^'"`]+)['"`]/g,
      ];
      const methods = ['GET', 'POST', 'PUT', 'DELETE'];

      // Loop each HTTP method pattern and extract all route matches in the file.
      patterns.forEach((pattern, i) => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          routes.push({
            method: methods[i],
            path: match[1],
            file: file.slice(this.rootDir.length + 1),
          });
        }
      });
    }

    return routes;
  }

  /**
   * findJsFiles — recursively collects .js and .ts file paths, skipping node_modules.
   * What: File discovery helper for route scanning.
   * How: readdir with withFileTypes; recurse dirs, collect matching files.
   */
  private async findJsFiles(dir: string): Promise<string[]> {
    const result: string[] = [];
    const children = await readdir(dir, { withFileTypes: true });

    for (const child of children) {
      const full = join(dir, child.name);
      if (child.isDirectory() && child.name !== 'node_modules') {
        result.push(...await this.findJsFiles(full));
      } else if (/\.(js|ts)$/.test(child.name)) {
        result.push(full);
      }
    }

    return result;
  }
}
