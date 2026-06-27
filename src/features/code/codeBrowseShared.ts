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

// Builds the Azure DevOps web URL for a path at a branch.
export function webUrl(
  organization: Organization | undefined,
  repo: RepoOption,
  path: string,
  branch: string,
): string {
  return `${repoBase(organization, repo)}?path=${encodeURIComponent(
    path,
  )}&version=GB${encodeURIComponent(branch)}&_a=contents`;
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
