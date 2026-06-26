/**
 * redact-secrets.ts — strip API keys and tokens from strings before logging or display.
 */

const INLINE_PATTERNS: Array<[RegExp, string]> = [
  [/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED]'],
  [/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]'],
  [/ghp_[a-zA-Z0-9]{20,}/g, '[REDACTED]'],
  [/github_pat_[a-zA-Z0-9_]{20,}/g, '[REDACTED]'],
  [/GEMINI_API_KEY[=:]\s*\S+/gi, 'GEMINI_API_KEY=[REDACTED]'],
  [/GOOGLE_API_KEY[=:]\s*\S+/gi, 'GOOGLE_API_KEY=[REDACTED]'],
  [/[?&]key=[^&\s]+/gi, 'key=[REDACTED]'],
  [/x-goog-api-key:\s*\S+/gi, 'x-goog-api-key: [REDACTED]'],
  [/(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]'],
  [/Bearer\s+\S+/gi, 'Bearer [REDACTED]'],
];

const STANDALONE_KEY_PATTERNS = [
  /^AIza[0-9A-Za-z_-]{20,}$/,
  /^sk-[a-zA-Z0-9]{20,}$/,
  /^ghp_[a-zA-Z0-9]{20,}$/,
  /^github_pat_[a-zA-Z0-9_]{20,}$/,
];

export function looksLikeSecret(value: string): boolean {
  return STANDALONE_KEY_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

export function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of INLINE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function safeErrorMessage(error: unknown, maxLength = 500): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message).slice(0, maxLength);
}

/** Config keys that must never be stored in .migit/config.json. */
export const FORBIDDEN_CONFIG_KEYS = new Set([
  'ai.key',
  'ai.apikey',
  'ai.api_key',
  'ai.api-key',
  'ai.token',
  'ai.secret',
  'ai.gemini_api_key',
  'ai.gemini-api-key',
]);

export const FORBIDDEN_CONFIG_FIELDS = new Set([
  'key',
  'apiKey',
  'api_key',
  'api-key',
  'token',
  'secret',
  'gemini_api_key',
  'geminiApiKey',
]);
