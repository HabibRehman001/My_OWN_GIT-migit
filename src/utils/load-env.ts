/**
 * load-env.ts — loads .env from cwd, repo root, or the migit package directory.
 * API keys stay in the environment — never written to .migit/config.json.
 */

import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepositoryRoot } from './paths.js';

export function loadEnv(): void {
  const candidates = [join(process.cwd(), '.env')];

  try {
    candidates.push(join(findRepositoryRoot(), '.env'));
  } catch {
    // Not inside a migit repository — skip repo-root .env.
  }

  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  candidates.push(join(packageRoot, '.env'));

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path });
    }
  }
}
