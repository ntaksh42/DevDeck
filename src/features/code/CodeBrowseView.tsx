import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Star } from "lucide-react";
import {
  listCommitRepositories,
  listRepoBranches,
} from "@/lib/azdoCommands";
import { useActiveOrganization } from "@/lib/useActiveConnection";
import { openExternalUrl } from "@/lib/openExternal";
import { FilterableSelect } from "@/features/pipelines/FilterableSelect";
import {
  ancestorFolders,
  blameUrl,
  ROOT,
  webUrl,
  type RepoOption,
  type Selection,
} from "./codeBrowseShared";
import {
  getFavoriteRepositoryIds,
  getLastSelection,
  setLastSelection,
  toggleFavoriteRepository,
} from "./codeBrowseStorage";
import { TreeLevel } from "./CodeFileTree";
import { CodeFilteredTree } from "./CodeFilteredTree";
import { Breadcrumb, TabButton } from "./CodeBrowseChrome";
import { CodeFolderView } from "./CodeFolderView";
import { CodeFileView } from "./CodeFileView";
import { CodeHistoryView } from "./CodeHistoryView";
import { CodeCompareView } from "./CodeCompareView";
import { CodeSearchResults } from "./CodeSearchResults";

type RightTab = "contents" | "history" | "compare";

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring";

// Browse a repository's files at a branch tip: a search box and file tree on
// the left, and the selected file/folder (Contents or History) on the right —
// the Azure DevOps Repos > Files layout. Pressing Enter in the search box runs a
// full-text code search scoped to the repository.
export function CodeBrowseView() {
  // The app points at a single active connection chosen in Settings.
  const organization = useActiveOrganization().data ?? undefined;
  const organizationId = organization?.id ?? "";

  const repositoriesQuery = useQuery({
    queryKey: ["commitRepositories", organizationId],
    queryFn: () => listCommitRepositories({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });
  const repositories: RepoOption[] = repositoriesQuery.data ?? [];

  const [repositoryId, setRepositoryId] = useState("");
  const repo = repositories.find((option) => option.repositoryId === repositoryId) ?? null;

  const [favorites, setFavorites] = useState<string[]>(() =>
    organizationId ? getFavoriteRepositoryIds(organizationId) : [],
  );
  useEffect(() => {
    setFavorites(organizationId ? getFavoriteRepositoryIds(organizationId) : []);
    setRepositoryId("");
    setRestoredBranch(null);
    pendingSelectionRef.current = null;
  }, [organizationId]);

  // Restore the last opened repository once the repository list loads, if the
  // user has not already picked one this session and it still exists. The last
  // opened path is held aside and applied once the branch has settled.
  const [restoredBranch, setRestoredBranch] = useState<string | null>(null);
  const pendingSelectionRef = useRef<Selection | null>(null);
  useEffect(() => {
    if (repositoryId || repositories.length === 0) return;
    const last = getLastSelection(organizationId);
    if (last && repositories.some((option) => option.repositoryId === last.repositoryId)) {
      setRepositoryId(last.repositoryId);
      setRestoredBranch(last.branch || null);
      pendingSelectionRef.current =
        last.path && last.path !== "/" ? { path: last.path, isFolder: last.isFolder } : null;
    }
  }, [organizationId, repositories, repositoryId]);

  function toggleFavorite() {
    if (!repo) return;
    setFavorites(toggleFavoriteRepository(organizationId, repo.repositoryId));
  }

  const branchesQuery = useQuery({
    queryKey: ["repoBranches", organizationId, repo?.projectId, repo?.repositoryId],
    queryFn: () =>
      listRepoBranches({
        organizationId,
        project: repo!.projectId,
        repository: repo!.repositoryId,
      }),
    enabled: !!organizationId && !!repo,
    staleTime: 5 * 60_000,
  });
  const branches = branchesQuery.data ?? [];

  const [branch, setBranch] = useState("");
  // Adopt the restored branch (if still present) or the repo's default branch
  // once branches load, unless the user already picked one that still exists.
  useEffect(() => {
    if (branches.length === 0) return;
    setBranch((current) => {
      if (current && branches.some((item) => item.name === current)) return current;
      if (restoredBranch && branches.some((item) => item.name === restoredBranch)) {
        return restoredBranch;
      }
      return (branches.find((item) => item.isDefault) ?? branches[0]).name;
    });
    setRestoredBranch(null);
  }, [branches, restoredBranch]);

  const [selected, setSelected] = useState<Selection>(ROOT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<RightTab>("contents");
  const [baseBranch, setBaseBranch] = useState("");
  // A commit picked via History > View, pinning the Contents tab to that ref.
  const [pinnedCommit, setPinnedCommit] = useState<{
    commitId: string;
    shortId: string;
  } | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);

  // Remember the open repository/branch/path so the view reopens here next time.
  useEffect(() => {
    if (organizationId && repositoryId && branch) {
      setLastSelection(organizationId, repositoryId, branch, selected.path, selected.isFolder);
    }
  }, [organizationId, repositoryId, branch, selected]);

  // Reset navigation state when the repository or branch changes. A restored
  // selection (held until the branch settles) replaces the root and expands
  // its ancestor folders so the tree shows where the user left off.
  useEffect(() => {
    const pending = branch ? pendingSelectionRef.current : null;
    if (branch) pendingSelectionRef.current = null;
    setSelected(pending ?? ROOT);
    setExpanded(
      pending
        ? new Set(
            pending.isFolder
              ? [...ancestorFolders(pending.path), pending.path]
              : ancestorFolders(pending.path),
          )
        : new Set(),
    );
    setFilterText("");
    setSearchQuery("");
    setTab("contents");
    setBaseBranch("");
    setPinnedCommit(null);
  }, [repositoryId, branch]);

  // Compare only applies to files; fall back to Contents when a folder is shown.
  useEffect(() => {
    if (selected.isFolder && tab === "compare") setTab("contents");
  }, [selected.isFolder, tab]);

  function toggleFolder(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function openFolder(path: string) {
    setSelected({ path, isFolder: true });
    setExpanded((prev) => new Set(prev).add(path));
    setPinnedCommit(null);
  }

  function openFile(path: string) {
    setSelected({ path, isFolder: false });
    setSearchQuery("");
    setTab("contents");
    setPinnedCommit(null);
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filterText.trim()) {
      event.preventDefault();
      setSearchQuery(filterText.trim());
    } else if (event.key === "Escape") {
      if (searchQuery) setSearchQuery("");
      else setFilterText("");
    }
  }

  // Keyboard navigation for the tree: arrows move/expand/collapse, Enter/Space
  // (native button activation) opens. Only the tree container is a tab stop.
  function onTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const container = treeRef.current;
    if (!container) return;
    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-tree-item]"),
    );
    if (rows.length === 0) return;
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      rows[index < 0 ? 0 : Math.min(index + 1, rows.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      rows[index <= 0 ? 0 : index - 1]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      rows[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      rows[rows.length - 1]?.focus();
    } else if (event.key === "ArrowRight" && index >= 0) {
      const row = rows[index];
      if (row.dataset.folder === "true") {
        event.preventDefault();
        if (row.dataset.open === "true") rows[Math.min(index + 1, rows.length - 1)]?.focus();
        else if (row.dataset.path) toggleFolder(row.dataset.path);
      }
    } else if (event.key === "ArrowLeft" && index >= 0) {
      const row = rows[index];
      event.preventDefault();
      if (row.dataset.folder === "true" && row.dataset.open === "true" && row.dataset.path) {
        toggleFolder(row.dataset.path);
      } else if (row.dataset.path) {
        const parent = row.dataset.path.replace(/\/[^/]+$/, "");
        rows.find((candidate) => candidate.dataset.path === parent)?.focus();
      }
    }
  }

  // When the tree gains focus via Tab, move into the first row.
  function onTreeFocus(event: React.FocusEvent<HTMLDivElement>) {
    if (event.target !== treeRef.current) return;
    treeRef.current
      ?.querySelector<HTMLButtonElement>("[data-tree-item]")
      ?.focus();
  }

  const repoOptions = useMemo(() => {
    const favoriteSet = new Set(favorites);
    return repositories
      .map((option) => ({
        value: option.repositoryId,
        label: `${favoriteSet.has(option.repositoryId) ? "★ " : ""}${option.projectName} / ${option.repositoryName}`,
        favorite: favoriteSet.has(option.repositoryId),
      }))
      // Favorites first, then keep the original (already project/repo-sorted) order.
      .sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [repositories, favorites]);
  const branchOptions = useMemo(
    () => branches.map((item) => ({ value: item.name, label: item.name })),
    [branches],
  );
  const isFavorite = !!repo && favorites.includes(repo.repositoryId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_minmax(180px,280px)]">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <FilterableSelect
              value={repositoryId}
              options={repoOptions}
              onChange={setRepositoryId}
              disabled={repositoriesQuery.isLoading || repoOptions.length === 0}
              placeholder="Select a repository"
              ariaLabel="Repository"
            />
          </div>
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={!repo}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Star
              className={`h-4 w-4 ${isFavorite ? "fill-amber-400 text-amber-400" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
        <FilterableSelect
          value={branch}
          options={branchOptions}
          onChange={setBranch}
          disabled={!repo || branchesQuery.isLoading || branchOptions.length === 0}
          placeholder="Branch"
          ariaLabel="Branch"
        />
      </div>

      {!repo ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-border bg-card text-sm text-muted-foreground">
          Select a repository to browse its files.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card">
          {/* Left: search box + file tree */}
          <div className="flex w-72 shrink-0 flex-col border-r border-border">
            <div className="relative border-b border-border p-2">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="text"
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Filter files / Enter to search"
                aria-label="Filter files by name, or press Enter for full-text search"
                className={INPUT_CLASS}
              />
            </div>
            <div
              ref={treeRef}
              role="tree"
              aria-label="Repository files"
              tabIndex={0}
              onKeyDown={onTreeKeyDown}
              onFocus={onTreeFocus}
              className="min-h-0 flex-1 overflow-y-auto py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {branch && filterText.trim() ? (
                <CodeFilteredTree
                  organizationId={organizationId}
                  repo={repo}
                  branch={branch}
                  filterText={filterText}
                  selectedPath={selected.path}
                  onOpenFolder={openFolder}
                  onOpenFile={openFile}
                />
              ) : branch ? (
                <TreeLevel
                  organizationId={organizationId}
                  repo={repo}
                  branch={branch}
                  parentPath="/"
                  depth={0}
                  selectedPath={selected.path}
                  expanded={expanded}
                  onToggle={toggleFolder}
                  onOpenFolder={openFolder}
                  onOpenFile={openFile}
                />
              ) : null}
            </div>
          </div>

          {/* Right: search results, or Contents/History of the selection */}
          {searchQuery ? (
            <CodeSearchResults
              organizationId={organizationId}
              repo={repo}
              branch={branch}
              query={searchQuery}
              onOpenFile={openFile}
              onClose={() => setSearchQuery("")}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <Breadcrumb
                    path={selected.path}
                    repositoryName={repo.repositoryName}
                    onNavigate={(target) =>
                      target === "/" ? setSelected(ROOT) : openFolder(target)
                    }
                  />
                  <div className="flex shrink-0 gap-1 text-sm">
                    <TabButton active={tab === "contents"} onClick={() => setTab("contents")}>
                      Contents
                    </TabButton>
                    <TabButton active={tab === "history"} onClick={() => setTab("history")}>
                      History
                    </TabButton>
                    {!selected.isFolder ? (
                      <TabButton active={tab === "compare"} onClick={() => setTab("compare")}>
                        Compare
                      </TabButton>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {!selected.isFolder ? (
                    <button
                      type="button"
                      onClick={() => openExternalUrl(blameUrl(organization, repo, selected.path, branch))}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                      title="Open Blame in Azure DevOps (no public REST blame API)"
                    >
                      Blame
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openExternalUrl(webUrl(organization, repo, selected.path, branch))}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    title="Open in Azure DevOps"
                  >
                    Open in Azure DevOps
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {tab === "history" ? (
                  <CodeHistoryView
                    organization={organization}
                    organizationId={organizationId}
                    repo={repo}
                    branch={branch}
                    path={selected.path}
                    onViewAtCommit={
                      !selected.isFolder
                        ? (commit) => {
                            setPinnedCommit({
                              commitId: commit.commitId,
                              shortId: commit.shortId,
                            });
                            setTab("contents");
                          }
                        : undefined
                    }
                  />
                ) : tab === "compare" && !selected.isFolder ? (
                  <CodeCompareView
                    organizationId={organizationId}
                    repo={repo}
                    branch={branch}
                    branchOptions={branchOptions}
                    baseBranch={baseBranch}
                    onBaseBranchChange={setBaseBranch}
                    path={selected.path}
                  />
                ) : selected.isFolder ? (
                  <CodeFolderView
                    organization={organization}
                    organizationId={organizationId}
                    repo={repo}
                    branch={branch}
                    path={selected.path}
                    onOpenFolder={openFolder}
                    onOpenFile={openFile}
                  />
                ) : (
                  <CodeFileView
                    organizationId={organizationId}
                    repo={repo}
                    branch={branch}
                    path={selected.path}
                    version={
                      pinnedCommit
                        ? { versionType: "commit", version: pinnedCommit.commitId }
                        : undefined
                    }
                    versionLabel={pinnedCommit ? `commit ${pinnedCommit.shortId}` : undefined}
                    onExitVersion={() => setPinnedCommit(null)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
