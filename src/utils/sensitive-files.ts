/**
 * sensitive-files.ts — paths that must never be tracked, analyzed, or documented.
 */

export function isSensitiveFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;

  if (base === '.env' || base.startsWith('.env.')) {
    return true;
  }

  return (
    base === '.npmrc' ||
    base === 'credentials.json' ||
    base.endsWith('.pem') ||
    base.endsWith('.key') ||
    base === 'id_rsa' ||
    base === 'id_ed25519'
  );
}
