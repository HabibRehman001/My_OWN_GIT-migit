#!/usr/bin/env node

import { loadEnv } from './utils/load-env.js';
loadEnv();

/**
 * cli.ts — main entry point for the migit command-line tool.
 * What: Bootstraps the Commander.js program and registers every subcommand.
 * How: Imports each command's register function, wires them to `program`,
 * then calls `program.parse()` to handle argv from the shell.
 */

// Commander provides the CLI framework (argument parsing, help text, options).
import { Command } from 'commander';

// Each command lives in its own file and exports a `registerXCommand` function
// that attaches a subcommand to the shared program instance.
import { registerInitCommand } from './commands/init.command.js';
import { registerAddCommand } from './commands/add.command.js';
import { registerStatusCommand } from './commands/status.command.js';
import { registerCommitCommand } from './commands/commit.command.js';
import { registerLogCommand } from './commands/log.command.js';
import { registerCheckoutCommand } from './commands/checkout.command.js';
import { registerBranchCommand } from './commands/branch.command.js';
import { registerHistoryCommand } from './commands/history.command.js';
import { registerDocumentCommand } from './commands/document.command.js';
import { registerDoctorCommand } from './commands/doctor.command.js';
import { registerConfigCommand } from './commands/config.command.js';

// Create the root Commander program object — this is the CLI app itself.
const program = new Command();

// Configure global CLI metadata shown in `--help` output.
program
  .name('migit')
  .description('A minimal Git-like version by Habib ')
  .version('0.1.0');

// Register every subcommand onto the program. Each function adds one command
// (e.g. `migit init`, `migit add`) with its own description and action handler.
registerInitCommand(program);
registerAddCommand(program);
registerStatusCommand(program);
registerCommitCommand(program);
registerLogCommand(program);
registerCheckoutCommand(program);
registerBranchCommand(program);
registerHistoryCommand(program);
registerDocumentCommand(program);
registerDoctorCommand(program);
registerConfigCommand(program);

// Parse process.argv — Commander matches the user's input to a subcommand
// and runs the corresponding async action handler.
program.parse();
