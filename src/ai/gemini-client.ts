/**
 * gemini-client.ts — Google Gemini API client with timeout and retry.
 * API keys are read from GEMINI_API_KEY env var only — never from config.json.
 */

import { MiGitError } from '../utils/errors.js';
import { DEFAULT_AI_MODEL } from '../core/config-store.js';
import { redactSecrets } from '../utils/redact-secrets.js';

export const GEMINI_DEFAULT_TIMEOUT_MS = 15_000;
export const GEMINI_MAX_ATTEMPTS = 2;

export interface GenerateOptions {
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key?.trim()) {
    throw new MiGitError(
      'Missing GEMINI_API_KEY. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey',
    );
  }
  return key.trim();
}

async function fetchGemini(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<string> {
  const apiKey = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const body = redactSecrets((await response.text()).slice(0, 200));
      throw new MiGitError(`Gemini API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw new MiGitError('Gemini returned an empty response');
    }

    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MiGitError(`Gemini request timed out after ${timeoutMs}ms`);
    }
    if (error instanceof MiGitError) {
      throw error;
    }
    throw new MiGitError(redactSecrets(error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * generate — sends a prompt to Gemini with timeout and at most one retry.
 */
export async function generate(
  prompt: string,
  modelOrOptions: string | GenerateOptions = {},
): Promise<string> {
  const options: GenerateOptions =
    typeof modelOrOptions === 'string' ? { model: modelOrOptions } : modelOrOptions;
  const model = options.model ?? DEFAULT_AI_MODEL;
  const timeoutMs = options.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? GEMINI_MAX_ATTEMPTS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchGemini(prompt, model, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(400);
      }
    }
  }

  if (lastError instanceof MiGitError) {
    throw lastError;
  }
  if (lastError instanceof Error) {
    throw new MiGitError(redactSecrets(lastError.message));
  }
  throw new MiGitError('Gemini request failed');
}
