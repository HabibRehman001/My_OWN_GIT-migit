/**
 * object-store.ts — content-addressable storage for blobs and commits.
 */

import { readFile, writeFile, readdir } from '../utils/file-system.js';
import { compress, decompress } from '../utils/compression.js';
import { getObjectsDir } from '../utils/paths.js';
import type { CommitData } from '../types/index.js';
import { createHash } from 'node:crypto';

export type ObjectType = 'blob' | 'commit';

export interface ParsedObject {
  type: ObjectType;
  payload: Buffer;
  serialized: Buffer;
  hash: string;
}

export interface StoredObjectRecord {
  type: ObjectType;
  payload: Buffer;
}

export interface ObjectStoreVerification {
  issues: string[];
  objects: Map<string, StoredObjectRecord>;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** SHA-256 hex digest of the full serialized object (`type size\\0payload`). */
export function hashSerializedObject(object: Buffer): string {
  return createHash('sha256').update(object).digest('hex');
}

/** Build `type <size>\\0<payload>`. */
function serializeObject(type: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`${type} `),
    Buffer.from(payload.length.toString()),
    Buffer.from('\0'),
    payload,
  ]);
}

/**
 * parseObject — validates header type/size and returns payload + canonical hash.
 */
export function parseObject(uncompressed: Buffer): ParsedObject | { error: string } {
  const nullIndex = uncompressed.indexOf(0);
  if (nullIndex === -1) {
    return { error: 'object header missing null terminator' };
  }

  const header = uncompressed.subarray(0, nullIndex).toString('utf8');
  const match = header.match(/^(blob|commit) (\d+)$/);
  if (!match) {
    return { error: `invalid object header "${header}"` };
  }

  const type = match[1] as ObjectType;
  const declaredSize = Number(match[2]);
  const payload = uncompressed.subarray(nullIndex + 1);

  if (payload.length !== declaredSize) {
    return {
      error: `object size mismatch: header declares ${declaredSize}, payload is ${payload.length}`,
    };
  }

  return {
    type,
    payload,
    serialized: uncompressed,
    hash: hashSerializedObject(uncompressed),
  };
}

export function isValidObjectHash(hash: string): boolean {
  return HASH_PATTERN.test(hash);
}

export class ObjectStore {
  constructor(private readonly rootDir: string) {}

  async writeBlob(content: Buffer): Promise<string> {
    return this.writeObject('blob', content);
  }

  blobId(content: Buffer): string {
    return hashSerializedObject(serializeObject('blob', content));
  }

  async readBlob(hash: string): Promise<Buffer> {
    const parsed = await this.readParsedObject(hash);
    if (parsed.type !== 'blob') {
      throw new Error(`Object ${hash} is not a blob`);
    }
    return parsed.payload;
  }

  async writeCommit(data: CommitData): Promise<string> {
    const body = Buffer.from(JSON.stringify(data));
    return this.writeObject('commit', body);
  }

  async readTree(treeHash: string): Promise<Map<string, string>> {
    const raw = await this.readBlob(treeHash);
    const tree = JSON.parse(raw.toString('utf-8')) as Record<string, string>;
    return new Map(Object.entries(tree));
  }

  async readCommit(hash: string): Promise<CommitData & { parent?: string }> {
    const parsed = await this.readParsedObject(hash);
    if (parsed.type !== 'commit') {
      throw new Error(`Object ${hash} is not a commit`);
    }
    return JSON.parse(parsed.payload.toString('utf-8')) as CommitData;
  }

  private async writeObject(type: string, payload: Buffer): Promise<string> {
    const object = serializeObject(type, payload);
    const hash = hashSerializedObject(object);
    const dir = getObjectsDir(this.rootDir);
    const objectPath = `${dir}/${hash.slice(0, 2)}/${hash.slice(2)}`;
    await writeFile(objectPath, compress(object));
    return hash;
  }

  private async readParsedObject(hash: string): Promise<ParsedObject> {
    const uncompressed = await this.readUncompressedObject(hash);
    const parsed = parseObject(uncompressed);
    if ('error' in parsed) {
      throw new Error(parsed.error);
    }
    return parsed;
  }

  private async readUncompressedObject(hash: string): Promise<Buffer> {
    const dir = getObjectsDir(this.rootDir);
    const objectPath = `${dir}/${hash.slice(0, 2)}/${hash.slice(2)}`;
    return decompress(await readFile(objectPath));
  }

  objectPathForHash(hash: string): string {
    const dir = getObjectsDir(this.rootDir);
    return `${dir}/${hash.slice(0, 2)}/${hash.slice(2)}`;
  }

  /**
   * verifyStorage — validates every stored object:
   * decompresses, checks header type/size, and recomputes SHA-256 vs path hash.
   */
  async verifyStorage(): Promise<ObjectStoreVerification> {
    const issues: string[] = [];
    const objects = new Map<string, StoredObjectRecord>();
    const dir = getObjectsDir(this.rootDir);

    let shards: string[];
    try {
      shards = await readdir(dir);
    } catch {
      issues.push('Objects directory is missing or unreadable');
      return { issues, objects };
    }

    for (const shard of shards) {
      if (!/^[a-f0-9]{2}$/.test(shard)) {
        issues.push(`Invalid object shard directory: objects/${shard}`);
        continue;
      }

      let files: string[];
      try {
        files = await readdir(`${dir}/${shard}`);
      } catch {
        issues.push(`Unreadable object shard directory: objects/${shard}`);
        continue;
      }

      for (const remainder of files) {
        const pathHash = `${shard}${remainder}`;
        const objectPath = `${dir}/${shard}/${remainder}`;

        if (!isValidObjectHash(pathHash)) {
          issues.push(`Invalid object filename (not a 64-char hash): ${shard}/${remainder}`);
          continue;
        }

        let uncompressed: Buffer;
        try {
          uncompressed = decompress(await readFile(objectPath));
        } catch {
          issues.push(`Corrupt or unreadable compressed object at ${shard}/${remainder}`);
          continue;
        }

        const parsed = parseObject(uncompressed);
        if ('error' in parsed) {
          issues.push(`Object ${pathHash}: ${parsed.error}`);
          continue;
        }

        if (parsed.hash !== pathHash) {
          issues.push(
            `Object hash mismatch at ${shard}/${remainder}: path says ${pathHash}, content hashes to ${parsed.hash}`,
          );
          continue;
        }

        objects.set(pathHash, { type: parsed.type, payload: parsed.payload });
      }
    }

    return { issues, objects };
  }

  /** @deprecated Use verifyStorage() via IntegrityChecker. */
  async verify(): Promise<string[]> {
    return (await this.verifyStorage()).issues;
  }
}
