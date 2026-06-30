/**
 * config-store.ts — loads and saves `.migit/config.json` (never stores API keys).
 */

import { userInfo } from 'node:os';
import { readFileSync } from 'node:fs';
import type { MiGitConfig } from '../types/index.js';
import { getConfigPath } from '../utils/paths.js';
import { readFile, existsSync } from '../utils/file-system.js';
import { MiGitError } from '../utils/errors.js';
import { atomicWrite } from '../utils/atomic-write.js';
import {
  FORBIDDEN_CONFIG_FIELDS,
  FORBIDDEN_CONFIG_KEYS,
} from '../utils/redact-secrets.js';

export const DEFAULT_AI_MODEL = 'gemini-2.5-flash';

const CONFIG_KEYS = ['user.name', 'user.email', 'ai.provider', 'ai.model'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/**
 * createDefaultConfig — in-memory defaults; API keys come from env vars only.
 */
export function createDefaultConfig(overrides?: {
  userName?: string;
  userEmail?: string;
}): MiGitConfig {
  const { username } = userInfo();

  return {
    user: {
      name:
        overrides?.userName?.trim() ||
        process.env.MIGIT_USER_NAME?.trim() ||
        username ||
        'migit user',
      email:
        overrides?.userEmail?.trim() ||
        process.env.MIGIT_USER_EMAIL?.trim() ||
        'migit@localhost',
    },
    ai: {
      provider: 'gemini',
    },
  };
}

/** Model resolution: optional config override → env → built-in default. */
export function resolveAiModel(config: MiGitConfig): string {
  return config.ai.model?.trim() || process.env.MIGIT_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

function mergeWithDefaults(partial: Partial<MiGitConfig>): MiGitConfig {
  const defaults = createDefaultConfig();
  const merged: MiGitConfig = {
    user: {
      name: partial.user?.name?.trim() || defaults.user.name,
      email: partial.user?.email?.trim() || defaults.user.email,
    },
    ai: {
      provider: partial.ai?.provider?.trim() || defaults.ai.provider,
      ...(partial.ai?.model?.trim() ? { model: partial.ai.model.trim() } : {}),
    },
  };

  if (partial.branches) {
    merged.branches = { ...partial.branches };
  }

  return merged;
}

function stripSecretFields(raw: Record<string, unknown>): Partial<MiGitConfig> {
  const ai = raw.ai;
  if (typeof ai === 'object' && ai !== null) {
    for (const field of FORBIDDEN_CONFIG_FIELDS) {
      delete (ai as Record<string, unknown>)[field];
    }
  }
  return raw as Partial<MiGitConfig>;
}

/** Only safe fields are written to disk — never API keys. */
function toPersistedConfig(config: MiGitConfig): Record<string, unknown> {
  const persisted: Record<string, unknown> = {
    user: config.user,
    ai: { provider: config.ai.provider },
  };

  if (config.ai.model?.trim()) {
    (persisted.ai as Record<string, string>).model = config.ai.model.trim();
  }

  if (config.branches) {
    persisted.branches = config.branches;
  }

  return persisted;
}

export function formatAuthor(config: MiGitConfig): string {
  return `${config.user.name} <${config.user.email}>`;
}

export function getConfigValue(config: MiGitConfig, key: ConfigKey): string {
  switch (key) {
    case 'user.name':
      return config.user.name;
    case 'user.email':
      return config.user.email;
    case 'ai.provider':
      return config.ai.provider;
    case 'ai.model':
      return resolveAiModel(config);
    default:
      throw new MiGitError(`Unknown config key: ${key}`);
  }
}

export function setConfigValue(config: MiGitConfig, key: ConfigKey, value: string): MiGitConfig {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new MiGitError(`Config value for ${key} cannot be empty`);
  }

  switch (key) {
    case 'user.name':
      return { ...config, user: { ...config.user, name: trimmed } };
    case 'user.email':
      return { ...config, user: { ...config.user, email: trimmed } };
    case 'ai.provider':
      return { ...config, ai: { ...config.ai, provider: trimmed } };
    case 'ai.model':
      return { ...config, ai: { ...config.ai, model: trimmed } };
    default:
      throw new MiGitError(`Unknown config key: ${key}`);
  }
}

export function parseConfigKey(key: string): ConfigKey {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_CONFIG_KEYS.has(normalized)) {
    throw new MiGitError(
      'API keys must be set via the GEMINI_API_KEY environment variable, not config.json',
    );
  }

  if ((CONFIG_KEYS as readonly string[]).includes(key)) {
    return key as ConfigKey;
  }

  throw new MiGitError(
    `Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.join(', ')}`,
  );
}

export class ConfigStore {
  constructor(private readonly rootDir: string) {}

  exists(): boolean {
    return existsSync(getConfigPath(this.rootDir));
  }

  async load(): Promise<MiGitConfig> {
    const path = getConfigPath(this.rootDir);
    if (!existsSync(path)) {
      return createDefaultConfig();
    }

    const raw = (await readFile(path)).toString('utf8');
    try {
      return mergeWithDefaults(stripSecretFields(JSON.parse(raw) as Record<string, unknown>));
    } catch {
      throw new MiGitError(`Invalid config at ${path} — expected JSON`);
    }
  }

  async save(config: MiGitConfig): Promise<void> {
    const path = getConfigPath(this.rootDir);
    await atomicWrite(path, `${JSON.stringify(toPersistedConfig(config), null, 2)}\n`);
  }

  async getAuthor(): Promise<string> {
    const config = await this.load();
    return formatAuthor(config);
  }

  verify(): string[] {
    const issues: string[] = [];
    const path = getConfigPath(this.rootDir);

    if (!existsSync(path)) {
      issues.push('Missing .migit/config.json — run "migit config user.name <name>" to create it');
      return issues;
    }

    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const ai = raw.ai;
      if (typeof ai === 'object' && ai !== null) {
        for (const field of FORBIDDEN_CONFIG_FIELDS) {
          if (field in (ai as Record<string, unknown>)) {
            issues.push(
              `Remove "${field}" from .migit/config.json — use GEMINI_API_KEY env var instead`,
            );
          }
        }
      }
    } catch {
      // Invalid JSON is reported by integrity checker / load().
    }

    return issues;
  }
}
