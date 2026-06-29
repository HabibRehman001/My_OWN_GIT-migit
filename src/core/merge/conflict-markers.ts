/**
 * conflict-markers.ts — detect merge conflict marker lines in file content.
 */

/** True when content still contains diff3-style conflict marker lines. */
export function hasConflictMarkers(content: string): boolean {
  return /^(<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)/m.test(content);
}
