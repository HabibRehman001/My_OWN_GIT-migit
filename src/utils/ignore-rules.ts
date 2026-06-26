/**
 * ignore-rules.ts — loads `.migitignore` and applies gitignore-like patterns.
 */

import { readFile } from './file-system.js';
import { existsSync } from './file-system.js';
import { join } from 'node:path';
import { isSensitiveFile } from './sensitive-files.js';

export const DEFAULT_MIGITIGNORE = `# Files and directories migit should not track
node_modules/
dist/
build/
coverage/
.env
.env.*
*.log
uploads/
`;

/** Always ignored — cannot be overridden by .migitignore negation. */
const ALWAYS_IGNORED = ['.migit', '.git', 'node_modules'] as const;

interface IgnorePattern {
  raw: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
  segments: string[];
  basenamePattern: string;
}

const cache = new Map<string, IgnoreRules>();

export class IgnoreRules {
  private constructor(
    private readonly rootDir: string,
    private readonly patterns: IgnorePattern[],
  ) {}

  static async load(rootDir: string): Promise<IgnoreRules> {
    const key = resolveKey(rootDir);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const rules = new IgnoreRules(rootDir, await loadPatterns(rootDir));
    cache.set(key, rules);
    return rules;
  }

  static clearCache(): void {
    cache.clear();
  }

  isIgnored(relativePath: string, isDirectory = false): boolean {
    const normalized = normalizePath(relativePath);
    if (!normalized || normalized === '.') {
      return false;
    }

    if (isAlwaysIgnored(normalized)) {
      return true;
    }

    if (isSensitiveFile(normalized)) {
      return true;
    }

    let ignored = false;
    for (const pattern of this.patterns) {
      if (this.matchesPattern(pattern, normalized, isDirectory)) {
        ignored = !pattern.negated;
      }
    }

    return ignored;
  }

  private matchesPattern(
    pattern: IgnorePattern,
    relativePath: string,
    isDirectory: boolean,
  ): boolean {
    if (pattern.directoryOnly && !isDirectory) {
      return false;
    }

    if (pattern.anchored) {
      return matchSegments(pattern.segments, relativePath.split('/'), pattern.basenamePattern);
    }

    if (pattern.segments.length > 1) {
      return matchSegments(pattern.segments, relativePath.split('/'), pattern.basenamePattern);
    }

    const parts = relativePath.split('/');
    const basename = parts[parts.length - 1] ?? relativePath;

    if (globMatch(basename, pattern.basenamePattern)) {
      return true;
    }

    return parts.some((part) => globMatch(part, pattern.basenamePattern));
  }
}

function resolveKey(rootDir: string): string {
  return join(rootDir);
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function isAlwaysIgnored(relativePath: string): boolean {
  const parts = relativePath.split('/');
  const basename = parts[parts.length - 1] ?? relativePath;

  for (const name of ALWAYS_IGNORED) {
    if (basename === name || parts.includes(name)) {
      return true;
    }
  }

  return basename === '.env' || basename.startsWith('.env.');
}

async function loadPatterns(rootDir: string): Promise<IgnorePattern[]> {
  const ignorePath = join(rootDir, '.migitignore');
  if (!existsSync(ignorePath)) {
    return parseIgnoreFile(DEFAULT_MIGITIGNORE);
  }

  try {
    const raw = (await readFile(ignorePath)).toString('utf8');
    return parseIgnoreFile(raw);
  } catch {
    return parseIgnoreFile(DEFAULT_MIGITIGNORE);
  }
}

export function parseIgnoreFile(content: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const pattern = parseIgnoreLine(trimmed);
    if (pattern) {
      patterns.push(pattern);
    }
  }

  return patterns;
}

function parseIgnoreLine(line: string): IgnorePattern | null {
  let raw = line;
  let negated = false;

  if (raw.startsWith('!')) {
    negated = true;
    raw = raw.slice(1).trim();
  }

  if (!raw) {
    return null;
  }

  const directoryOnly = raw.endsWith('/');
  if (directoryOnly) {
    raw = raw.slice(0, -1);
  }

  const anchored = raw.startsWith('/');
  if (anchored) {
    raw = raw.slice(1);
  }

  const segments = raw.split('/').filter(Boolean);
  const basenamePattern = segments.length > 0 ? segments[segments.length - 1] : raw;

  return {
    raw: line,
    negated,
    directoryOnly,
    anchored,
    segments,
    basenamePattern,
  };
}

function matchSegments(
  patternSegments: string[],
  pathSegments: string[],
  basenamePattern: string,
): boolean {
  if (patternSegments.length === 0) {
    return false;
  }

  if (patternSegments.length === 1) {
    const part = pathSegments[pathSegments.length - 1] ?? '';
    return globMatch(part, basenamePattern);
  }

  if (pathSegments.length < patternSegments.length) {
    return false;
  }

  for (let start = 0; start <= pathSegments.length - patternSegments.length; start++) {
    let matched = true;
    for (let i = 0; i < patternSegments.length; i++) {
      if (!globMatch(pathSegments[start + i], patternSegments[i])) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

function globMatch(value: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/{{GLOBSTAR}}/g, '.*');

  return new RegExp(`^${regex}$`).test(value);
}

export async function ensureDefaultMigitignore(rootDir: string): Promise<void> {
  const ignorePath = join(rootDir, '.migitignore');
  if (existsSync(ignorePath)) {
    return;
  }

  const { atomicWrite } = await import('./atomic-write.js');
  await atomicWrite(ignorePath, DEFAULT_MIGITIGNORE);
}
