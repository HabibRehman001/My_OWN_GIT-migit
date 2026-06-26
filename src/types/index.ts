/**
 * MiGitObject — represents a stored version-control object (blob, tree, or commit).
 * What: A generic container for any object written to the object store.
 * How: The `type` field identifies the kind; `content` holds the raw bytes.
 * Works like Git's object model where everything is typed binary content.
 */
export interface MiGitObject {
  type: 'blob' | 'tree' | 'commit';
  content: Buffer;
}

/**
 * TreeEntry — one file entry inside a directory tree snapshot.
 * What: Maps a filename to its content hash and Unix file mode.
 * How: Used when building tree objects that list files at a commit point.
 */
export interface TreeEntry {
  mode: string;
  name: string;
  hash: string;
}

/**
 * CommitData — metadata stored inside a commit object.
 * What: Links a tree snapshot to its parent, author, time, and message.
 * How: Serialized as JSON inside the commit object in the object store.
 * The optional `parent` creates a linked list of commits (history chain).
 */
export interface CommitData {
  tree: string;
  parent?: string;
  author: string;
  timestamp: number;
  message: string;
}

/**
 * StagedEntry — one file currently in the staging index (like `git add`).
 * What: Records path, content hash, and file mode for a staged file.
 * How: The index file is a JSON array of these entries on disk.
 */
export interface StagedEntry {
  path: string;
  hash: string;
  mode: string;
}

/**
 * StatusEntry — three-way compare result (HEAD vs index vs working tree).
 * staged: HEAD ≠ index (added / modified / deleted in index vs last commit)
 * working: index ≠ disk (modified / deleted / untracked vs index)
 */
export interface StatusEntry {
  path: string;
  staged: 'added' | 'modified' | 'deleted' | 'untracked' | null;
  working: 'modified' | 'deleted' | 'untracked' | null;
}

/**
 * RefInfo — a named reference (branch/tag) pointing to a commit hash.
 * What: Pairs a human-readable ref name with an object hash.
 * How: Branch files in `.migit/refs/heads/` store just the hash; this type
 * is used when we need both name and hash together in application code.
 */
export interface RefInfo {
  name: string;
  hash: string;
}

/**
 * MiGitConfig — repository settings stored in `.migit/config.json`.
 */
export interface MiGitConfig {
  user: {
    name: string;
    email: string;
  };
  ai: {
    provider: string;
    model?: string;
  };
}
