/**
 * documentation-generator.ts — orchestrates all analyzers into one markdown document.
 * What: Produces a full DOCUMENTATION.md from project scans and framework analysis.
 * How: Runs analyzers in parallel via Promise.all, assembles markdown sections.
 */

import { ProjectScanner } from './project-scanner.js';
import { StackDetector } from './stack-detector.js';
import { PackageAnalyzer } from './package-analyzer.js';
import { ExpressAnalyzer } from './express-analyzer.js';
import { ReactAnalyzer } from './react-analyzer.js';
import { MongooseAnalyzer } from './mongoose-analyzer.js';

/**
 * DocumentationGenerator — main entry point for `migit document`.
 * What: Coordinates all document/* analyzers and formats output as markdown.
 */
export class DocumentationGenerator {
  constructor(private readonly rootDir: string = process.cwd()) {}

  /**
   * generate — runs all analyzers and returns a complete markdown string.
   * What: Builds sections: Overview, Tech Stack, Package Info, Routes, Components, Models.
   * How:
   *   1. Instantiate each analyzer scoped to rootDir.
   *   2. Promise.all runs all scans concurrently for speed.
   *   3. Build lines array with markdown headers and bullet lists.
   *   4. Conditionally add sections only when data exists (routes, components, models).
   *   5. Join lines with newlines into final document string.
   */
  async generate(): Promise<string> {
    const scanner = new ProjectScanner(this.rootDir);
    const stackDetector = new StackDetector(this.rootDir);
    const packageAnalyzer = new PackageAnalyzer(this.rootDir);
    const expressAnalyzer = new ExpressAnalyzer(this.rootDir);
    const reactAnalyzer = new ReactAnalyzer(this.rootDir);
    const mongooseAnalyzer = new MongooseAnalyzer(this.rootDir);

    // Run all analyzers in parallel — each is independent I/O + CPU work.
    const [files, stack, pkg, routes, components, models] = await Promise.all([
      scanner.scan(),
      stackDetector.detect(),
      packageAnalyzer.analyze(),
      expressAnalyzer.analyze(),
      reactAnalyzer.analyze(),
      mongooseAnalyzer.analyze(),
    ]);

    // Start building markdown lines with overview and tech stack sections.
    const lines: string[] = [
      '# Project Documentation',
      '',
      '## Overview',
      '',
      `Total files scanned: ${files.length}`,
      '',
      '## Tech Stack',
      '',
      `- Languages: ${stack.languages.join(', ') || 'N/A'}`,
      `- Frameworks: ${stack.frameworks.join(', ') || 'N/A'}`,
      `- Runtime: ${stack.runtime ?? 'N/A'}`,
      '',
    ];

    // Add package.json section only if package.json was found and parsed.
    if (pkg) {
      lines.push(
        '## Package Info',
        '',
        `- Name: ${pkg.name}`,
        `- Version: ${pkg.version}`,
        `- Scripts: ${Object.keys(pkg.scripts).join(', ') || 'none'}`,
        '',
      );
    }

    // Add Express routes section if any routes were detected.
    if (routes.length > 0) {
      lines.push('## Express Routes', '');
      for (const route of routes) {
        lines.push(`- ${route.method} ${route.path} (${route.file})`);
      }
      lines.push('');
    }

    // Add React components section if any components were found.
    if (components.length > 0) {
      lines.push('## React Components', '');
      for (const comp of components) {
        lines.push(`- ${comp.name} (${comp.file})${comp.hasHooks ? ' [hooks]' : ''}`);
      }
      lines.push('');
    }

    // Add Mongoose models section if any models were detected.
    if (models.length > 0) {
      lines.push('## Mongoose Models', '');
      for (const model of models) {
        lines.push(`- ${model.name} (${model.file}): ${model.fields.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
