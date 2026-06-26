import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeArgs, getSafeErrorMessage } from '../src/history/history-sanitize.js';
import { redactSecrets } from '../src/utils/redact-secrets.js';

describe('history and secret redaction', () => {
  it('sanitizeArgs redacts env assignments and standalone API keys', () => {
    const args = sanitizeArgs([
      'commit',
      '--smart',
      'GEMINI_API_KEY=AIzaSyD-example-key-that-is-long-enough-1234567890',
      'AIzaSyD-example-key-that-is-long-enough-1234567890',
    ]);
    assert.equal(args[2], 'GEMINI_API_KEY=[REDACTED]');
    assert.equal(args[3], '[REDACTED]');
  });

  it('sanitizeArgs redacts values after sensitive flags', () => {
    const args = sanitizeArgs(['config', '--token', 'super-secret-value']);
    assert.equal(args[1], '--token');
    assert.equal(args[2], '[REDACTED]');
  });

  it('getSafeErrorMessage redacts keys embedded in errors', () => {
    const message = getSafeErrorMessage(
      new Error('Gemini failed: GEMINI_API_KEY=AIzaSyD-example-key-that-is-long-enough-1234567890'),
    );
    assert.doesNotMatch(message, /AIzaSyD/);
    assert.match(message, /\[REDACTED\]/);
  });

  it('redactSecrets removes URL query keys', () => {
    const cleaned = redactSecrets('request failed: https://api.test?key=secret-value&model=x');
    assert.match(cleaned, /key=\[REDACTED\]/);
    assert.doesNotMatch(cleaned, /secret-value/);
  });
});
