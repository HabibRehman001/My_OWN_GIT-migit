/**
 * branch.command.ts — registers the `migit branch` subcommand.
 * What: Lists branches, creates new ones, or deletes existing ones.
 * How: Three modes based on args: no name = list, -d = delete, name = create.
 */

import type { Command } from 'commander';
import { Repository } from '../core/repository.js';
import { withHistoryAction } from '../cli/with-history.js';
import { formatBranchStandardsHelp, resolveBranchStandards } from '../utils/branch-standards.js';
import {
  computeConflictRisk,
  formatConflictRiskReport,
} from '../core/merge/conflict-risk.js';

/**
 * registerBranchCommand — attaches `branch [name]` with optional delete flag.
 * What: Branch management from the command line.
 * How:
 *   - No name: list all branches, mark current with `*`.
 *   - Name + no -d: create branch pointing at current HEAD.
 *   - Name + -d: delete the named branch file.
 */
export function registerBranchCommand(program: Command): void {
  program
    .command('branch risk <incomingBranch>')
    .description('Predict likely merge conflicts with another branch (hash-only analysis)')
    .action(
      withHistoryAction('branch risk', async (incomingBranch: string) => {
        const repo = Repository.open();
        const report = await computeConflictRisk(repo, incomingBranch);
        console.log(formatConflictRiskReport(report));
      }),
    );

  program
    .command('branch [name]')
    .description('List, create, or delete branches')
    .option('-d, --delete', 'delete a branch')
    .option('--no-verify', 'skip branch naming standards when creating a branch')
    .option('--standards', 'show branch naming conventions')
    .action(
      withHistoryAction('branch', async (name: string | undefined, options: { delete?: boolean; noVerify?: boolean; standards?: boolean }) => {
      const repo = Repository.open();

      if (options.standards) {
        const config = await repo.configStore.load();
        console.log(formatBranchStandardsHelp(resolveBranchStandards(config)));
        return;
      }

      if (!name) {
        const branches = await repo.listBranches();
        const current = await repo.getCurrentBranch();

        for (const branch of branches) {
          const marker = branch === current ? '*' : ' ';
          console.log(`${marker} ${branch}`);
        }
        return;
      }

      if (options.delete) {
        await repo.deleteBranch(name);
        console.log(`Deleted branch ${name}`);
      } else {
        await repo.createBranch(name, { noVerify: options.noVerify });
        console.log(`Created branch ${name}`);
      }
    }),
    );
}
