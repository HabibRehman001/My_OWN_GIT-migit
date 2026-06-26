/**
 * compression.ts — gzip compression for object store files.
 * What: Shrinks object data before writing to disk to save space.
 * How: Wraps Node's synchronous zlib gzip/gunzip functions.
 * Works: Objects are compressed on write and decompressed on read transparently.
 */

import { gzipSync, gunzipSync } from 'node:zlib';

/**
 * compress — gzip-compresses a Buffer synchronously.
 * What: Reduces the byte size of an object before persisting it.
 * How: Calls gzipSync which returns a new compressed Buffer.
 */
export function compress(data: Buffer): Buffer {
  return gzipSync(data);
}

/**
 * decompress — reverses gzip compression back to the original Buffer.
 * What: Restores readable object bytes from a stored compressed file.
 * How: Calls gunzipSync on the compressed buffer read from disk.
 */
export function decompress(data: Buffer): Buffer {
  return gunzipSync(data);
}
