/**
 * repository.ts — central facade for all version-control operations.
 * What: The main API that commands use — init, add, commit, log, branches, integrity.
 * How: Composes ObjectStore, IndexStore, Refs, and Scanner into one cohesive class.
 * Works: Each public method validates repo state, then delegates to the right submodule.
 */

import { ObjectStore } from './object-store.js';
import { IndexStore } from './index-store.js';
import { Refs } from './refs.js';
import { Scanner } from './scanner.js';
import { ConfigStore, createDefaultConfig } from './config-store.js';
import { IntegrityChecker } from './integrity-checker.js';
import { createCommit } from './commit.js';
import { getPrimaryParent } from './commit-normalize.js';
import { GenerationResolver, generationFromParents } from './merge/generation.js';
import { createSnapshot } from './snapshot.js';
import { getMiGitDir, findRepositoryRoot } from '../utils/paths.js';
import { findScopedDeletions } from '../utils/add-scope.js';
import { validateBranchName } from '../utils/branch-name.js';
import { ensureDir, existsSync } from '../utils/file-system.js';
import { MiGitError } from '../utils/errors.js';
import { assertNoMergeDuringBranchDelete, assertNoMergeDuringCommit } from './merge/merge-guard.js';
import { assertRepositoryUnlockedAsync } from './repository-lock.js';
import { ensureDefaultMigitignore } from '../utils/ignore-rules.js';

/**
 * Repository — orchestrates migit's object store, index, refs, and file scanner.
 * What: Single entry point for all repo-level read/write operations.
 * How: Constructor wires up sub-modules all scoped to the same rootDir.
 */
export class Repository {
  readonly objectStore: ObjectStore;
  readonly indexStore: IndexStore;
  readonly refs: Refs;
  readonly scanner: Scanner;
  readonly configStore: ConfigStore;

  /**
   * open — discovers and opens the repository containing the current working directory.
   * What: Use for all normal commands (add, commit, status, …) run from any subfolder.
   * How: Calls findRepositoryRoot() to walk up until `.migit` is found, then constructs Repository.
   */
  static open(startDir: string = process.cwd()): Repository {
    return new Repository(findRepositoryRoot(startDir));
  }

  /**
   * at — opens a repository at an explicit root path (no upward search).
   * What: Use for `migit init`, which must create `.migit` in cwd only.
   * How: Passes rootDir directly to the constructor.
   */
  static at(rootDir: string): Repository {
    return new Repository(rootDir);
  }

  /**
   * Constructor — creates all sub-modules for a known project root directory.
   * What: Binds the repo to the folder that CONTAINS `.migit` (not the .migit folder itself).
   * How: Instantiates ObjectStore, IndexStore, Refs, Scanner with rootDir.
   */
  constructor(readonly rootDir: string) {
    this.objectStore = new ObjectStore(rootDir);
    this.indexStore = new IndexStore(rootDir);
    this.refs = new Refs(rootDir);
    this.scanner = new Scanner(rootDir, this.objectStore);
    this.configStore = new ConfigStore(rootDir);
  }

  /**
   * init — creates a fresh migit repository in rootDir.
   * Re-running on a repo with commit history requires force: true.
   */
  async init(options?: {
    userName?: string;
    userEmail?: string;
    force?: boolean;
  }): Promise<'created' | 'reinitialized'> {
    const migitDir = getMiGitDir(this.rootDir);
    const alreadyExists = existsSync(migitDir);
    const hadHistory = alreadyExists ? (await this.refs.getHead()) !== null : false;

    if (alreadyExists && hadHistory && !options?.force) {
      throw new MiGitError(
        'A migit repository already exists with commit history. ' +
          'Use "migit init --force" to reinitialize and clear history.',
      );
    }

    await ensureDir(migitDir);
    await ensureDir(`${migitDir}/objects`);
    await ensureDir(`${migitDir}/refs/heads`);

    if (alreadyExists) {
      await this.refs.clearBranchRefs();
    }

    await this.refs.initHead('main');
    await this.indexStore.save([]);
    await this.configStore.save(createDefaultConfig(options));
    await ensureDefaultMigitignore(this.rootDir);

    return alreadyExists ? 'reinitialized' : 'created';
  }

  /**
   * assertInitialized — throws if `.migit` does not exist.
   * What: Guard used before any operation that requires an initialized repo.
   * How: Sync check via existsSync on the migit directory path.
   */
  assertInitialized(): void {
    if (!existsSync(getMiGitDir(this.rootDir))) {
      throw new MiGitError('Not a migit repository. Run "migit init" first.');
    }
  }

  /**
   * add — merges files at the given paths into the index; stages deletions in scope.
   * Files removed from disk within the add scope are removed from the index.
   */
  async add(paths: string[]): Promise<void> {
    this.assertInitialized();
    const staged = await this.scanner.stage(paths);
    const workingPaths = new Set(staged.map((e) => e.path));
    const currentIndex = await this.indexStore.load();
    const deletions = await findScopedDeletions(
      currentIndex.map((e) => e.path),
      workingPaths,
      paths,
      this.rootDir,
    );
    await this.indexStore.merge(staged, deletions);
  }

  /**
   * commit — creates a commit from the complete index; index is kept after commit.
   * HEAD tree = index = clean working tree when nothing has changed on disk.
   */
  async commit(message: string): Promise<string> {
    this.assertInitialized();
    assertNoMergeDuringCommit(this.rootDir);
    await assertRepositoryUnlockedAsync(this.rootDir);
    const index = await this.indexStore.load();
    const tree = await createSnapshot(this.objectStore, index);
    const parent = await this.refs.getHead();
    const parents = parent ? [parent] : [];
    const author = await this.configStore.getAuthor();
    const generationResolver = new GenerationResolver(this.objectStore, this.rootDir);
    await generationResolver.init();
    const parentGenerations = await Promise.all(
      parents.map((hash) => generationResolver.getGeneration(hash)),
    );
    const generation = generationFromParents(parentGenerations);
    const hash = await createCommit(this.objectStore, {
      tree,
      parents,
      author,
      timestamp: Date.now(),
      message,
      generation,
    });
    await generationResolver.flush();
    await this.refs.setHead(hash);
    return hash;
  }

  /**
   * log — walks the first-parent chain from HEAD (parents[0]), up to maxCount commits.
   * Merge commits are included; side-parent history is not walked until log --graph exists.
   */
  async log(maxCount: number): Promise<Array<{
    hash: string;
    author: string;
    timestamp: number;
    message: string;
    parents: string[];
  }>> {
    this.assertInitialized();
    const commits: Array<{
      hash: string;
      author: string;
      timestamp: number;
      message: string;
      parents: string[];
    }> = [];
    let current = await this.refs.getHead();

    while (current && commits.length < maxCount) {
      const commit = await this.objectStore.readCommit(current);
      commits.push({
        hash: current,
        author: commit.author,
        timestamp: commit.timestamp,
        message: commit.message,
        parents: [...commit.parents],
      });
      current = getPrimaryParent(commit);
    }

    return commits;
  }

  /** listBranches — returns names of all branches in refs/heads/. */
  async listBranches(): Promise<string[]> {
    this.assertInitialized();
    return this.refs.listBranches();
  }

  /** getCurrentBranch — returns the active branch name (e.g. "main"). */
  async getCurrentBranch(): Promise<string> {
    this.assertInitialized();
    return this.refs.getCurrentBranch();
  }

  /**
   * createBranch — creates a new branch pointing at the current HEAD commit.
   */
  async createBranch(name: string): Promise<void> {
    this.assertInitialized();
    validateBranchName(name);

    const branches = await this.listBranches();
    if (branches.includes(name)) {
      throw new MiGitError(`A branch named "${name}" already exists.`);
    }

    const head = await this.refs.getHead();
    await this.refs.setBranch(name, head);
  }

  /** deleteBranch — removes a branch ref file from refs/heads/. */
  async deleteBranch(name: string): Promise<void> {
    this.assertInitialized();
    assertNoMergeDuringBranchDelete(this.rootDir);
    await assertRepositoryUnlockedAsync(this.rootDir);
    validateBranchName(name);

    const branches = await this.listBranches();
    if (!branches.includes(name)) {
      throw new MiGitError(`Branch "${name}" does not exist.`);
    }

    const current = await this.getCurrentBranch();
    if (current === name) {
      throw new MiGitError(
        `Cannot delete branch "${name}" because it is currently checked out.`,
      );
    }

    await this.refs.deleteBranch(name);
  }

  /**
   * checkIntegrity — deep repository health checks for `migit doctor`.
   */
  async checkIntegrity(): Promise<string[]> {
    this.assertInitialized();
    return new IntegrityChecker(this).run();
  }
}
