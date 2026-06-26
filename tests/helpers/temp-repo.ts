import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repository } from '../../src/core/repository.js';

export interface TempRepo {
  root: string;
  repo: Repository;
  cleanup: () => Promise<void>;
}

export async function createTempRepo(): Promise<TempRepo> {
  const root = await mkdtemp(join(tmpdir(), 'migit-test-'));
  const repo = Repository.at(root);
  await repo.init();

  return {
    root,
    repo,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function writeProjectFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}
