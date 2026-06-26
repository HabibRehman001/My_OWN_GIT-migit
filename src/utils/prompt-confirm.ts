/**
 * prompt-confirm.ts — interactive CLI confirmation.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function confirmCommitMessage(message: string): Promise<boolean> {
  console.log('\nProposed commit message:');
  console.log(`  ${message}\n`);

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question('Commit with this message? [y/N] ');
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
