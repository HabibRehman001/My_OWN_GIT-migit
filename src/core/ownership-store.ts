/**
 * ownership-store.ts — loads and saves `.migit/ownership.json`.
 */

import { readFileSync } from 'node:fs';
import type { MiGitOwnership, OwnershipRule } from '../types/index.js';
import { getOwnershipPath } from '../utils/paths.js';
import { readFile, existsSync } from '../utils/file-system.js';
import { MiGitError } from '../utils/errors.js';
import { atomicWrite } from '../utils/atomic-write.js';

export function createDefaultOwnership(): MiGitOwnership {
  return {
    rules: [
      { pattern: 'src/api/**', team: 'backend' },
      { pattern: 'src/components/**', team: 'frontend' },
      { pattern: 'src/models/**', team: 'database' },
      { pattern: 'infra/**', team: 'devops' },
    ],
  };
}

function normalizeRules(rules: OwnershipRule[] | undefined): OwnershipRule[] {
  if (!rules?.length) {
    return [];
  }

  return rules
    .map((rule) => ({
      pattern: rule.pattern?.trim() ?? '',
      team: rule.team?.trim() ?? '',
    }))
    .filter((rule) => rule.pattern && rule.team);
}

function mergeWithDefaults(partial: Partial<MiGitOwnership>): MiGitOwnership {
  const defaults = createDefaultOwnership();

  return {
    rules: partial.rules?.length ? normalizeRules(partial.rules) : defaults.rules,
  };
}

export class OwnershipStore {
  constructor(private readonly rootDir: string) {}

  exists(): boolean {
    return existsSync(getOwnershipPath(this.rootDir));
  }

  async load(): Promise<MiGitOwnership> {
    const path = getOwnershipPath(this.rootDir);
    if (!existsSync(path)) {
      return createDefaultOwnership();
    }

    const raw = (await readFile(path)).toString('utf8');
    try {
      return mergeWithDefaults(JSON.parse(raw) as Partial<MiGitOwnership>);
    } catch {
      throw new MiGitError(`Invalid ownership at ${path} — expected JSON`);
    }
  }

  async save(ownership: MiGitOwnership): Promise<void> {
    const path = getOwnershipPath(this.rootDir);
    await atomicWrite(path, `${JSON.stringify(ownership, null, 2)}\n`);
  }

  verify(): string[] {
    const issues: string[] = [];
    const path = getOwnershipPath(this.rootDir);

    if (!existsSync(path)) {
      issues.push(
        'Missing .migit/ownership.json — run "migit init" on a new repo or copy the default ownership file',
      );
      return issues;
    }

    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<MiGitOwnership>;
      if (!Array.isArray(raw.rules)) {
        issues.push('ownership.json: "rules" must be an array');
        return issues;
      }

      for (const [index, rule] of raw.rules.entries()) {
        if (typeof rule !== 'object' || rule === null) {
          issues.push(`ownership.json: rules[${index}] must be an object`);
          continue;
        }
        if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) {
          issues.push(`ownership.json: rules[${index}].pattern must be a non-empty string`);
        }
        if (typeof rule.team !== 'string' || !rule.team.trim()) {
          issues.push(`ownership.json: rules[${index}].team must be a non-empty string`);
        }
      }
    } catch {
      issues.push('Invalid .migit/ownership.json — expected JSON');
    }

    return issues;
  }
}
