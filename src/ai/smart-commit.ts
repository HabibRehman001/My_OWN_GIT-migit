import type { Repository } from '../core/repository.js';
import { generate } from './gemini-client.js';
import { buildStagedChangeSummary } from './staged-changes.js';
import { toSmartCommitPayload } from './change-summary.js';
import { fallbackMessage } from './commit-fallback.js';
import { normalizeCommitMessage } from './commit-message.js';
import { resolveAiModel } from '../core/config-store.js';

export interface SmartCommitOptions {
  pathsOnly?: boolean;
}

function buildPathsOnlyPrompt(paths: string[]): string {
  return [
    'Write a single-line git commit message for these staged files.',
    'Use imperative mood. Max 72 characters. No quotes. No explanation.',
    '',
    'Files:',
    ...paths.map((path) => `- ${path}`),
  ].join('\n');
}

function buildMetadataPrompt(changes: object): string {
  return [
    'Write a single-line git commit message from this staged-change summary.',
    'Use imperative mood. Max 72 characters. No quotes. No explanation.',
    'Do not invent changes that are not supported by the summary.',
    '',
    JSON.stringify(changes, null, 2),
  ].join('\n');
}

/**
 * generateSmartCommitMessage — asks Gemini using safe metadata, with deterministic fallback.
 */
export async function generateSmartCommitMessage(
  repo: Repository,
  options: SmartCommitOptions = {},
): Promise<{ message: string; usedFallback: boolean }> {
  const changes = await buildStagedChangeSummary(repo);
  const config = await repo.configStore.load();

  const prompt = options.pathsOnly
    ? buildPathsOnlyPrompt(changes.files.map((file) => file.path))
    : buildMetadataPrompt(toSmartCommitPayload(changes));

  try {
    const raw = await generate(prompt, {
      model: resolveAiModel(config),
      timeoutMs: 15_000,
      maxAttempts: 2,
    });

    const message = normalizeCommitMessage(raw);
    if (message) {
      return { message, usedFallback: false };
    }
  } catch {
    // Fall through to deterministic message.
  }

  return { message: fallbackMessage(changes), usedFallback: true };
}
