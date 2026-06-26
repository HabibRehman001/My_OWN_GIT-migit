/**
 * document.command.ts — registers the `migit document` subcommand.
 * What: Auto-generates project documentation by scanning the codebase.
 * How: DocumentationGenerator analyzes the project; atomicWrite saves output.
 */

import { resolve } from 'node:path';
import type { Command } from 'commander';
import { DocumentationGenerator } from '../document/documentation-generator.js';
import { findRepositoryRoot } from '../utils/paths.js';
import { existsSync } from '../utils/file-system.js';
import { MiGitError } from '../utils/errors.js';
import { withHistoryAction } from '../cli/with-history.js';

/** Resolve output path and refuse to clobber an existing file unless force is set. */
export function prepareDocumentOutput(output: string, force?: boolean): string {
  const outputPath = resolve(process.cwd(), output);
  if (existsSync(outputPath) && !force) {
    throw new MiGitError(`${output} already exists.\nUse --force to replace it.`);
  }
  return outputPath;
}

/**
 * registerDocumentCommand — attaches `document` with output path option.
 * What: Produces a markdown DOCUMENTATION.md (or custom path) from code analysis.
 * How:
 *   1. Run all analyzers (stack, routes, components, models).
 *   2. Dynamically import atomicWrite to avoid circular deps at load time.
 *   3. Write result safely to disk and confirm to the user.
 */
export function registerDocumentCommand(program: Command): void {
  program
    .command('document')
    .description('Generate project documentation')
    .option('-o, --output <path>', 'output file path', 'DOCUMENTATION.md')
    .option('-f, --force', 'overwrite existing output file')
    .action(
      withHistoryAction('document', async (options: { output: string; force?: boolean }) => {
      let rootDir = process.cwd();
      try {
        rootDir = findRepositoryRoot();
      } catch {
        // Not inside a migit repo — document the current directory.
      }
      const outputPath = prepareDocumentOutput(options.output, options.force);
      const generator = new DocumentationGenerator(rootDir);
      const doc = await generator.generate();
      const { atomicWrite } = await import('../utils/atomic-write.js');
      await atomicWrite(outputPath, doc);
      console.log(`Documentation written to ${options.output}`);
    }),
    );
}
