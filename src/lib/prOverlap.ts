// Pure overlap detection for the multi-PR conflict-risk warning.
//
// Given the changed-file sets of several selected pull requests, find files
// that more than one PR touches. Those shared files are where independent
// branches are most likely to collide when merged, so the grid surfaces them
// as a conflict-risk hint before the reviewer picks a merge order.

export type PrFileSet = {
  /** Stable identity of the PR (e.g. `${repositoryId}:${pullRequestId}`). */
  key: string;
  /** Changed file paths for the PR. */
  files: string[];
};

export type FileOverlap = {
  /** The file path touched by more than one selected PR. */
  path: string;
  /** Keys of the PRs that touch this file, in selection order. */
  prKeys: string[];
};

export type OverlapResult = {
  /** Overlapping files, sorted by path for stable display. */
  overlaps: FileOverlap[];
  /** Number of distinct files touched by more than one PR. */
  fileCount: number;
};

/**
 * Detects changed files shared by two or more of the given PRs.
 *
 * Each PR's file list is de-duplicated before comparison so a path listed
 * twice in one PR never counts as an overlap with itself. A file counts as an
 * overlap only when at least two distinct PRs touch it.
 */
export function detectFileOverlaps(prFileSets: PrFileSet[]): OverlapResult {
  // path -> ordered, de-duplicated list of PR keys that touch it.
  const pathToPrKeys = new Map<string, string[]>();

  for (const { key, files } of prFileSets) {
    const seenInThisPr = new Set<string>();
    for (const path of files) {
      if (seenInThisPr.has(path)) continue;
      seenInThisPr.add(path);
      const keys = pathToPrKeys.get(path);
      if (keys) keys.push(key);
      else pathToPrKeys.set(path, [key]);
    }
  }

  const overlaps: FileOverlap[] = [];
  for (const [path, prKeys] of pathToPrKeys) {
    if (prKeys.length >= 2) {
      overlaps.push({ path, prKeys });
    }
  }
  overlaps.sort((a, b) => a.path.localeCompare(b.path));

  return { overlaps, fileCount: overlaps.length };
}
