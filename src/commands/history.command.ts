/**
 * history.command.ts — registers the `migit history` subcommand.
 */

import type { Command } from 'commander';
import { HistoryReader } from '../history/history-reader.js';
import {
  formatBasicExplanation,
  formatHistoryForExplain,
  formatHistoryLine,
} from '../history/history-format.js';
import { findRepositoryRoot } from '../utils/paths.js';
import { ConfigStore, resolveAiModel } from '../core/config-store.js';
import { generate } from '../ai/gemini-client.js';
import { withHistoryAction } from '../cli/with-history.js';

async function showHistory(): Promise<void> {
  const rootDir = findRepositoryRoot();
  const reader = new HistoryReader(rootDir);
  const entries = await reader.read();

  for (const entry of entries) {
    console.log(formatHistoryLine(entry));
  }
}

async function explainHistory(options: { ai?: boolean }): Promise<void> {
  const rootDir = findRepositoryRoot();
  const reader = new HistoryReader(rootDir);
  const entries = await reader.read();

  if (entries.length === 0) {
    console.log('No command history to explain.');
    return;
  }

  if (options.ai) {
    const lines = entries
      .slice(-20)
      .map((entry) => formatHistoryForExplain(entry))
      .join('\n');

    const config = await new ConfigStore(rootDir).load();
    const explanation = await generate(
      `Briefly explain what the user was doing from these migit commands:\n\n${lines}`,
      resolveAiModel(config),
    );
    console.log(explanation);
    return;
  }

  console.log(formatBasicExplanation(entries));
}

export function registerHistoryCommand(program: Command): void {
  const history = program.command('history').description('Show command history');

  history
    .option('--explain', 'alias for `migit history explain --ai`')
    .action(
      withHistoryAction('history', async (options: { explain?: boolean }) => {
        if (options.explain) {
          await explainHistory({ ai: true });
          return;
        }
        await showHistory();
      }),
    );

  history
    .command('explain')
    .description('Explain command history')
    .option('--ai', 'Use AI for a friendlier explanation')
    .action(
      withHistoryAction('history explain', async (options: { ai?: boolean }) => {
        await explainHistory(options);
      }),
    );
}
