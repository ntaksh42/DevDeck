import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Star } from "lucide-react";
import {
  listCommitRepositories,
  listRepoBranches,
} from "@/lib/azdoCommands";
import { useActiveOrganization } from "@/lib/useActiveConnection";
import { openExternalUrl } from "@/lib/openExternal";
import { clamp } from "@/lib/utils";
import { FilterableSelect } from "@/features/pipelines/FilterableSelect";
import { blameUrl, ROOT, webUrl, type RepoOption, type Selection } from "./codeBrowseShared";
import {
  getFavoriteRepositoryIds,
  getLastSelection,
  getTreeWidth,
  setLastSelection,
  setTreeWidth,
  toggleFavoriteRepository,
  MAX_TREE_WIDTH,
  MIN_TREE_WIDTH,
} from "./codeBrowseStorage";
import { handleTreeKeyDown, type TypeAheadState } from "./codeTreeKeyboard";
import { TreeLevel } from "./CodeFileTree";
import { CodeFolderView } from "./CodeFolderView";
import { CodeFileView } from "./CodeFileView";
import { CodeHistoryView } from "./CodeHistoryView";
import { CodeCompareView } from "./CodeCompareView";
import { CodeSearchResults } from "./CodeSearchResults";
import { CodeViewTabs, CODE_TABPANEL_ID, type RightTab } from "./CodeViewTabs";

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
  const repositories = (repositoriesQuery.data ?? []) as RepoOption[];

  const [repositoryId, setRepositoryId] = useState("");
  const repo = repositories.find((option) => option.repositoryId === repositoryId) ?? null;

  const [favorites, setFavorites] = useState<string[]>(() =>
    organizationId ? getFavoriteRepositoryIds(organizationId) : [],
  );
  useEffect(() => {
    setFavorites(organizationId ? getFavoriteRepositoryIds(organizationId) : []);
  }, [organizationId]);

  // Restore the last opened repository once the repository list loads, if the
  // user has not already picked one this session and it still exists.
  const [restoredBranch, setRestoredBranch] = useState<string | null>(null);
  useEffect(() => {
    if (repositoryId || repositories.length === 0) return;
    const last = getLastSelection(organizationId);
    if (last && repositories.some((option) => option.repositoryId === last.repositoryId)) {
      setRepositoryId(last.repositoryId);
      setRestoredBranch(last.branch || null);
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

  // Remember the open repository/branch so the view reopens here next time.
  useEffect(() => {
    if (organizationId && repositoryId && branch) {
      setLastSelection(organizationId, repositoryId, branch);
    }
  }, [organizationId, repositoryId, branch]);

  const [selected, setSelected] = useState<Selection>(ROOT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<RightTab>("contents");
  const [baseBranch, setBaseBranch] = useState("");
  const treeRef = useRef<HTMLDivElement | null>(null);
  const typeAheadRef = useRef<TypeAheadState>({ text: "", time: 0 });

  // File tree panel width, drag- or keyboard-resizable and persisted across
  // sessions (see the resize handle below).
  const [treeWidth, setTreeWidthState] = useState<number>(() => getTreeWidth());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);
  const activeResizeListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(
    null,
  );

  function persistTreeWidth(width: number): number {
    setTreeWidth(width);
    return width;
  }

  // Remove a drag still in progress if the view unmounts mid-drag (e.g. the
  // user switches away from Code while dragging).
  useEffect(() => {
    return () => {
      const active = activeResizeListenersRef.current;
      if (active) {
        window.removeEventListener("mousemove", active.move);
        window.removeEventListener("mouseup", active.up);
      }
    };
  }, []);

  // Reset navigation state when the repository or branch changes.
  useEffect(() => {
    setSelected(ROOT);
    setExpanded(new Set());
    setFilterText("");
    setSearchQuery("");
    setTab("contents");
    setBaseBranch("");
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
  }

  function openFile(path: string) {
    setSelected({ path, isFolder: false });
    setSearchQuery("");
    setTab("contents");
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

  // Keyboard navigation for the tree: arrows move/expand/collapse, Home/End
  // jump to the first/last row, PageUp/PageDown jump by a page, typing a
  // letter jumps to the next match (type-ahead), and Enter/Space (native
  // button activation) opens. Only the tree container is a tab stop; the
  // row-finding logic lives in codeTreeKeyboard so it's unit-testable.
  function onTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    handleTreeKeyDown(event, treeRef.current, typeAheadRef, toggleFolder);
  }

  // When the tree gains focus via Tab, move into the first row.
  function onTreeFocus(event: React.FocusEvent<HTMLDivElement>) {
    if (event.target !== treeRef.current) return;
    treeRef.current
      ?.querySelector<HTMLButtonElement>("[data-tree-item]")
      ?.focus();
  }

  // Drag-to-resize the tree panel: track the pointer relative to the bordered
  // panel's left edge so the handle works regardless of page layout.
  function onResizeMouseDown(event: React.MouseEvent) {
    event.preventDefault();
    resizingRef.current = true;
    const left = panelRef.current?.getBoundingClientRect().left ?? 0;
    function onMouseMove(moveEvent: MouseEvent) {
      if (!resizingRef.current) return;
      setTreeWidthState(clamp(moveEvent.clientX - left, MIN_TREE_WIDTH, MAX_TREE_WIDTH));
    }
    function onMouseUp() {
      resizingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      activeResizeListenersRef.current = null;
      setTreeWidthState((current) => persistTreeWidth(current));
    }
    activeResizeListenersRef.current = { move: onMouseMove, up: onMouseUp };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  // Keyboard alternative to dragging: ArrowLeft/Right resize in steps
  // (Shift for a bigger step), Home/End snap to the min/max width.
  function onResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setTreeWidthState((current) => persistTreeWidth(clamp(current - step, MIN_TREE_WIDTH, MAX_TREE_WIDTH)));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setTreeWidthState((current) => persistTreeWidth(clamp(current + step, MIN_TREE_WIDTH, MAX_TREE_WIDTH)));
    } else if (event.key === "Home") {
      event.preventDefault();
      setTreeWidthState(persistTreeWidth(MIN_TREE_WIDTH));
    } else if (event.key === "End") {
      event.preventDefault();
      setTreeWidthState(persistTreeWidth(MAX_TREE_WIDTH));
    }
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
        <div
          ref={panelRef}
          className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        >
          {/* Left: search box + file tree */}
          <div
            className="flex shrink-0 flex-col border-r border-border"
            style={{ width: treeWidth }}
          >
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
              {branch ? (
                <TreeLevel
                  organizationId={organizationId}
                  repo={repo}
                  branch={branch}
                  parentPath="/"
                  depth={0}
                  filterText={filterText}
                  selectedPath={selected.path}
                  expanded={expanded}
                  onToggle={toggleFolder}
                  onOpenFolder={openFolder}
                  onOpenFile={openFile}
                />
              ) : null}
            </div>
          </div>
          {/* Drag handle: resizes the tree panel; ArrowLeft/Right (Shift for a
              bigger step) and Home/End provide a keyboard equivalent. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize file tree"
            aria-valuenow={treeWidth}
            aria-valuemin={MIN_TREE_WIDTH}
            aria-valuemax={MAX_TREE_WIDTH}
            tabIndex={0}
            onMouseDown={onResizeMouseDown}
            onKeyDown={onResizeKeyDown}
            className="w-1 shrink-0 cursor-col-resize border-r border-border outline-none hover:bg-ring focus-visible:bg-ring"
          />

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
                  <Breadcrumb path={selected.path} repositoryName={repo.repositoryName} />
                  <CodeViewTabs tab={tab} onChange={setTab} showCompare={!selected.isFolder} />
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
              <div
                role="tabpanel"
                id={CODE_TABPANEL_ID}
                aria-labelledby={`code-tab-${tab}`}
                className="min-h-0 flex-1 overflow-auto"
              >
                {tab === "history" ? (
                  <CodeHistoryView
                    organization={organization}
                    organizationId={organizationId}
                    repo={repo}
                    branch={branch}
                    path={selected.path}
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
                    organization={organization}
                    organizationId={organizationId}
                    repo={repo}
                    branch={branch}
                    path={selected.path}
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

function Breadcrumb({ path, repositoryName }: { path: string; repositoryName: string }) {
  const segments = path.split("/").filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-1 truncate text-sm">
      <span className="font-medium">{repositoryName}</span>
      {segments.map((segment, index) => (
        <span key={index} className="text-muted-foreground">
          / {segment}
        </span>
      ))}
    </div>
  );
}
