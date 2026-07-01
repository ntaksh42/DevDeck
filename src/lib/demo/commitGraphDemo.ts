// Demo-mode data for the commit graph view (browser dev path, no Tauri
// backend). Kept in its own file so `commits.ts` — already near the 500-line
// guideline — does not have to grow for a single extra case.
import { demoCommits } from "@/lib/demo/commits";

export interface DemoCommitParentsEntry {
  commitId: string;
  parentIds: string[];
}

/**
 * Synthesizes a linear parent chain per repository from the fixed demo
 * commit list: within each repository, commits are ordered newest-first (as
 * the real search result would be), and each commit's parent is simply the
 * next-older commit in that same repository. This mirrors the shape the real
 * backend returns (parents per commit id) without needing an actual DAG in
 * the fixture data — the graph view still exercises the real lane-assignment
 * algorithm on real (if linear) data.
 */
export function demoCommitParents(commitIds: string[]): DemoCommitParentsEntry[] {
  const all = demoCommits();
  const byRepository = new Map<string, typeof all>();
  for (const commit of all) {
    const bucket = byRepository.get(commit.repositoryId) ?? [];
    bucket.push(commit);
    byRepository.set(commit.repositoryId, bucket);
  }

  const parentsById = new Map<string, string[]>();
  for (const bucket of byRepository.values()) {
    const sorted = [...bucket].sort((a, b) =>
      (b.authorDate ?? "").localeCompare(a.authorDate ?? ""),
    );
    sorted.forEach((commit, index) => {
      const parent = sorted[index + 1];
      parentsById.set(commit.commitId, parent ? [parent.commitId] : []);
    });
  }

  const requested = new Set(commitIds);
  return Array.from(parentsById.entries())
    .filter(([commitId]) => requested.has(commitId))
    .map(([commitId, parentIds]) => ({ commitId, parentIds }));
}
