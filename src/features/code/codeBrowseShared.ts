import { useQuery } from "@tanstack/react-query";
import { listRepoTree, type Organization } from "@/lib/azdoCommands";

export type RepoOption = {
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryName: string;
};

export type Selection = { path: string; isFolder: boolean };

export const ROOT: Selection = { path: "/", isFolder: true };

// Lazy query for a folder's children. The tree calls it without commit info
// (cheap, frequent), the folder table with it (one extra server-side join);
// the flag is part of the key so the two never share a cache entry.
export function useTreeQuery(
  organizationId: string,
  repo: RepoOption,
  branch: string,
  path: string,
  includeLastCommit: boolean,
) {
  return useQuery({
    queryKey: ["repoTree", organizationId, repo.repositoryId, branch, path, includeLastCommit],
    queryFn: () =>
      listRepoTree({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
        path,
        includeLastCommit,
      }),
    enabled: !!branch,
    staleTime: 60_000,
  });
}

// Formats an ISO date as a short, locale-aware label for tables and history.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function repoBase(organization: Organization | undefined, repo: RepoOption): string {
  const base = organization?.baseUrl?.replace(/\/$/, "") ?? "";
  return `${base}/${encodeURIComponent(repo.projectName)}/_git/${encodeURIComponent(
    repo.repositoryName,
  )}`;
}

// Builds the Azure DevOps web URL for a commit.
export function commitUrl(
  organization: Organization | undefined,
  repo: RepoOption,
  commitId: string,
): string {
  return `${repoBase(organization, repo)}/commit/${commitId}`;
}

export type LineRange = { start: number; end: number };

// Builds the Azure DevOps web URL for a path at a branch. When `lines` is
// given, appends the line-range query params Azure DevOps Web uses for
// permalinks (`?...&line=10&lineEnd=20`).
export function webUrl(
  organization: Organization | undefined,
  repo: RepoOption,
  path: string,
  branch: string,
  lines?: LineRange,
): string {
  const base = `${repoBase(organization, repo)}?path=${encodeURIComponent(
    path,
  )}&version=GB${encodeURIComponent(branch)}&_a=contents`;
  if (!lines) return base;
  return `${base}&line=${lines.start}&lineEnd=${lines.end}&lineStartColumn=1&lineEndColumn=1&lineStyle=plain`;
}

// Parses a `#L10` (single line) or `#L10-L20` (range) URL hash into a 1-based,
// normalized (start <= end) line range. Returns null for an absent or
// unrecognized hash.
export function parseLineHash(hash: string): LineRange | null {
  const match = /^#?L(\d+)(?:-L?(\d+))?$/.exec(hash.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < 1) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

// Builds a `#L10` or `#L10-L20` hash for a line range, matching GitHub's
// permalink format.
export function lineHash(range: LineRange): string {
  return range.start === range.end ? `#L${range.start}` : `#L${range.start}-L${range.end}`;
}

// Builds the Azure DevOps web Blame URL for a file. Azure DevOps has no public
// REST blame endpoint, so per-line blame is delegated to the web UI.
export function blameUrl(
  organization: Organization | undefined,
  repo: RepoOption,
  path: string,
  branch: string,
): string {
  return `${repoBase(organization, repo)}?path=${encodeURIComponent(
    path,
  )}&version=GB${encodeURIComponent(branch)}&_a=blame`;
}

// The last path segment, e.g. `/src/main.py` → `main.py`. The root shows the
// repository name instead, handled by callers.
export function leafName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}
