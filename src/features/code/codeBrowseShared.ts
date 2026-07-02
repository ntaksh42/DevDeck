import { useQuery } from "@tanstack/react-query";
import {
  getRepoFile,
  listRepoTree,
  type Organization,
  type RepoFileVersion,
} from "@/lib/azdoCommands";

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

// Shared query for a file's content at a branch tip (or at an explicit
// version ref). Used by the file view, the folder README preview, and both
// sides of the compare view, which all key the cache the same way (so a file
// fetched once is reused across them).
export function useRepoFile(
  organizationId: string,
  repo: RepoOption,
  branch: string,
  path: string,
  version?: RepoFileVersion,
) {
  return useQuery({
    queryKey: [
      "repoFile",
      organizationId,
      repo.repositoryId,
      branch,
      path,
      version?.versionType ?? "",
      version?.version ?? "",
    ],
    queryFn: () =>
      getRepoFile({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
        path,
        versionType: version?.versionType,
        version: version?.version,
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

// The ancestor folder paths of a path, outermost first, excluding the root and
// the path itself: `/src/lib/a.ts` → ["/src", "/src/lib"].
export function ancestorFolders(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => "/" + segments.slice(0, index + 1).join("/"));
}

// Roving keyboard navigation for a table of focusable row buttons matching
// `selector` inside `container`: ArrowUp/ArrowDown (or K/J) move, Home/End
// jump. Returns true when the key was handled.
export function handleRowNavKey(
  event: { key: string; preventDefault: () => void },
  container: HTMLElement | null,
  selector: string,
): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const down = key === "ArrowDown" || key === "j";
  const up = key === "ArrowUp" || key === "k";
  if (!down && !up && key !== "Home" && key !== "End") return false;
  const rows = Array.from(container?.querySelectorAll<HTMLButtonElement>(selector) ?? []);
  if (rows.length === 0) return false;
  event.preventDefault();
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (key === "Home") rows[0]?.focus();
  else if (key === "End") rows[rows.length - 1]?.focus();
  else if (down) rows[index < 0 ? 0 : Math.min(index + 1, rows.length - 1)]?.focus();
  else rows[index <= 0 ? 0 : index - 1]?.focus();
  return true;
}
