/**
 * mongoose-analyzer.ts — finds Mongoose model definitions in source code.
 * What: Detects mongoose.model() / model() calls and schema field names.
 * How: Regex on JS/TS files after recursive file discovery.
 */

import { readFile } from '../utils/file-system.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * MongooseModel — metadata for one discovered Mongoose schema/model.
 * What: Model name, source file, and list of detected field names.
 */
export interface MongooseModel {
  name: string;
  file: string;
  fields: string[];
}

/**
 * MongooseAnalyzer — static analysis of Mongoose model registrations.
 * What: Powers the "Mongoose Models" section in generated documentation.
 */
export class MongooseAnalyzer {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * analyze — scans JS/TS files for Mongoose model definitions.
   * What: Returns model name, file, and inferred schema fields.
   * How:
   *   1. findJsFiles() collects source paths.
   *   2. Regex for mongoose.model('Name') or model('Name').
   *   3. matchAll for `fieldName: {` patterns to extract field names.
   */
  async analyze(): Promise<MongooseModel[]> {
    const models: MongooseModel[] = [];
    const files = await this.findJsFiles(this.rootDir);

    for (const file of files) {
      const content = (await readFile(file)).toString('utf-8');
      const schemaMatch = content.match(
        /(?:mongoose\.model|model)\(\s*['"`](\w+)['"`]/,
      );
      if (!schemaMatch) continue;

      const fieldMatches = [...content.matchAll(/(\w+)\s*:\s*\{/g)];
      models.push({
        name: schemaMatch[1],
        file: file.slice(this.rootDir.length + 1),
        fields: fieldMatches.map((m) => m[1]),
      });
    }

    return models;
  }

  /**
   * findJsFiles — recursively collects .js and .ts files, skipping node_modules.
   * What: Shared file-discovery pattern used by framework analyzers.
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
