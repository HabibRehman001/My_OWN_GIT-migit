/**
 * doctor.command.ts — registers the `migit doctor` subcommand.
 * What: Health check for the repository — verifies .migit exists and objects are readable.
 * How: Uses Repository.open() to discover repo from any subfolder, then verifies objects.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { MiGitError } from '../utils/errors.js';
import { withHistoryAction } from '../cli/with-history.js';

/**
 * registerDoctorCommand — attaches `doctor` diagnostic command to the CLI.
 * What: Reports repository problems or confirms everything is healthy.
 * How: Collects issues into an array; exit code 1 if any issues found.
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose repository health (refs, objects, index, commit graph)')
    .action(
      withHistoryAction('doctor', async () => {
      const issues: string[] = [];

      try {
        const repo = Repository.open();
        const integrity = await repo.checkIntegrity();
        issues.push(...integrity);
      } catch (err) {
        if (err instanceof MiGitError) {
          issues.push('No migit repository found in this directory or any parent folder');
        } else {
          throw err;
        }
      }

      if (issues.length === 0) {
        console.log('All checks passed. Repository is healthy.');
      } else {
        console.log('Issues found:');
        for (const issue of issues) {
          console.log(`  - ${issue}`);
        }
        process.exitCode = 1;
      }
    }),
    );
}
