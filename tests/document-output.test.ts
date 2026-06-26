import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDocumentOutput } from '../src/commands/document.command.js';
import { MiGitError } from '../src/utils/errors.js';

describe('document output protection', () => {
  it('allows writing when output file does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-doc-out-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      const outputPath = prepareDocumentOutput('DOCUMENTATION.md');
      assert.equal(outputPath, join(root, 'DOCUMENTATION.md'));
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks overwrite by default when output already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-doc-block-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      await writeFile(join(root, 'DOCUMENTATION.md'), '# Hand-written docs\n', 'utf8');

      assert.throws(
        () => prepareDocumentOutput('DOCUMENTATION.md'),
        (error: unknown) => {
          assert.ok(error instanceof MiGitError);
          assert.match(String(error), /DOCUMENTATION\.md already exists/);
          assert.match(String(error), /--force to replace it/);
          return true;
        },
      );
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows overwrite when --force is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migit-doc-force-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(root);
      const existing = join(root, 'docs', 'API.md');
      await mkdir(join(root, 'docs'), { recursive: true });
      await writeFile(existing, '# Original\n', 'utf8');

      const outputPath = prepareDocumentOutput('docs/API.md', true);
      assert.equal(outputPath, existing);

      const before = await readFile(existing, 'utf8');
      assert.equal(before, '# Original\n');
    } finally {
      process.chdir(previousCwd);
      await rm(root, { recursive: true, force: true });
    }
  });
});
