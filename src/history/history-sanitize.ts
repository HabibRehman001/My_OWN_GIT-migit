/**
 * history-sanitize.ts — redact secrets before writing command history.
 */

import { looksLikeSecret, safeErrorMessage } from '../utils/redact-secrets.js';

const SENSITIVE_ENV_PREFIXES = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'MIGIT_',
  'API_KEY',
  'SECRET',
  'PASSWORD',
  'TOKEN',
] as const;

const SENSITIVE_FLAG_NAMES = new Set([
  'password',
  'passwd',
  'token',
  'secret',
  'api-key',
  'apikey',
  'key',
  'auth',
  'authorization',
  'credential',
  'credentials',
]);

function looksLikeApiKey(value: string): boolean {
  return looksLikeSecret(value);
}

function isSensitiveEnvAssignment(arg: string): boolean {
  const eq = arg.indexOf('=');
  if (eq <= 0) {
    return false;
  }
  const name = arg.slice(0, eq).toUpperCase();
  return SENSITIVE_ENV_PREFIXES.some(
    (prefix) => name === prefix || name.startsWith(prefix) || name.endsWith('_KEY'),
  );
}

function flagName(arg: string): string | null {
  if (!arg.startsWith('-')) {
    return null;
  }
  const body = arg.startsWith('--') ? arg.slice(2) : arg.slice(1);
  const name = body.split('=')[0]?.toLowerCase();
  return name || null;
}

function isSensitiveFlag(name: string): boolean {
  if (SENSITIVE_FLAG_NAMES.has(name)) {
    return true;
  }
  return (
    name.includes('password') ||
    name.includes('secret') ||
    name.includes('token') ||
    name.includes('api-key') ||
    name.includes('apikey')
  );
}

/**
 * sanitizeArgs — strips API keys, passwords, tokens, and env secrets from argv.
 */
export function sanitizeArgs(args: string[]): string[] {
  const result: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      result.push('[REDACTED]');
      redactNext = false;
      continue;
    }

    if (isSensitiveEnvAssignment(arg)) {
      const eq = arg.indexOf('=');
      result.push(`${arg.slice(0, eq + 1)}[REDACTED]`);
      continue;
    }

    if (looksLikeApiKey(arg)) {
      result.push('[REDACTED]');
      continue;
    }

    const name = flagName(arg);
    if (name && isSensitiveFlag(name)) {
      if (arg.includes('=')) {
        const [flag] = arg.split('=');
        result.push(`${flag}=[REDACTED]`);
      } else {
        result.push(arg);
        redactNext = true;
      }
      continue;
    }

    result.push(arg);
  }

  return result;
}

/**
 * getSafeErrorMessage — error text safe to persist (no keys or long secrets).
 */
export function getSafeErrorMessage(error: unknown): string {
  return safeErrorMessage(error);
}
