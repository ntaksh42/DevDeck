import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  Fragment,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, GitPullRequest, Info, Loader2, Maximize2, Minimize2, Search } from "lucide-react";
import {
  searchCommits,
  listCommitRepositories,
  getCommitPullRequests,
  commandErrorMessage,
  type CommitSummary,
  type CommitPullRequest,
  type CommitRepositoryOption,
  type Organization,
} from "@/lib/azdoCommands";
import {
  clamp,
  storedNumbers,
  storedNumber,
  gridColumnTemplate,
  isEditableTarget,
  focusFilterInput,
  focusPrimaryGrid,
  focusPrimaryPreview,
  formatDate,
  formatRelativeDate,
} from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { ColumnResizeHandle, ResizeHandle } from "@/components/ResizeHandle";
import { ColumnVisibilityMenu } from "@/components/ColumnVisibilityMenu";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { ActiveFilters } from "@/components/ActiveFilters";
import { SavedSearchBar, useApplySearchPreset } from "@/components/SavedSearchBar";
import type { CommitSearchPayload } from "@/lib/searchPresets";
import { CommitFilesPanel } from "./CommitFilesPanel";
import { CommitActivityHeatmap } from "./CommitActivityHeatmap";

const DEFAULT_COMMIT_PREVIEW_WIDTH = 460;
const MIN_COMMIT_PREVIEW_WIDTH = 320;
const MAX_COMMIT_PREVIEW_WIDTH = 8192;
const COMMIT_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:commitPreviewWidth";

const DEFAULT_COMMIT_COLUMN_WIDTHS = [72, 80, 220, 140, 120, 44];
const COMMIT_COLUMN_MIN_WIDTHS = [66, 72, 160, 110, 96, 40];
const COMMIT_COLUMN_MAX_WIDTHS = [140, 160, 720, 380, 340, 72];
const COMMIT_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:commitGridColumnWidths:v3";
const COMMIT_SEARCH_VIEW_STORAGE_KEY = "azdodeck:view:commitSearch:v1";
const COMMIT_VIEW_MODE_STORAGE_KEY = "azdodeck:view:commitViewMode:v1";
const COMMIT_SORT_STORAGE_KEY = "azdodeck:view:commitGridSort:v1";
const COMMIT_VISIBLE_COLUMNS_STORAGE_KEY = "azdodeck:layout:commitVisibleColumns:v1";
const COMMIT_GRID_ROW_HEIGHT = 29;
const COMMIT_GRID_OVERSCAN = 8;

// Column order mirrors the width arrays above: sha, date, comment, repository,
// author, pr. SHA and the message stay required so the grid is never blank.
type CommitColumnKey = "sha" | "date" | "comment" | "repository" | "author" | "pr";
const COMMIT_COLUMN_KEYS: CommitColumnKey[] = [
  "sha",
  "date",
  "comment",
  "repository",
  "author",
  "pr",
];
const COMMIT_COLUMN_LABELS: Record<CommitColumnKey, string> = {
  sha: "SHA",
  date: "Date",
  comment: "Message",
  repository: "Repository",
  author: "Author",
  pr: "PR",
};
const COMMIT_REQUIRED_COLUMNS: CommitColumnKey[] = ["sha", "comment"];

function loadCommitVisibleColumns(): CommitColumnKey[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(COMMIT_VISIBLE_COLUMNS_STORAGE_KEY) ?? "null",
    );
    if (!Array.isArray(parsed)) return [...COMMIT_COLUMN_KEYS];
    const set = new Set(
      parsed.filter((v): v is CommitColumnKey =>
        COMMIT_COLUMN_KEYS.includes(v as CommitColumnKey),
      ),
    );
    for (const required of COMMIT_REQUIRED_COLUMNS) set.add(required);
    const ordered = COMMIT_COLUMN_KEYS.filter((key) => set.has(key));
    return ordered.length > 0 ? ordered : [...COMMIT_COLUMN_KEYS];
  } catch {
    return [...COMMIT_COLUMN_KEYS];
  }
}

function commitPrQueryKey(commit: CommitSummary) {
  return ["commitPullRequests", commit.organizationId, commit.repositoryId, commit.commitId] as const;
}

const PR_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  abandoned: "Abandoned",
};

function prStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300";
    case "abandoned":
      return "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
    default:
      return "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300";
  }
}

type CommitSearchViewState = {
  author: string;
  branch: string;
  fromDate: string;
  organizationId: string;
  projectId: string;
  query: string;
  repositoryId: string;
  toDate: string;
};

function loadCommitSearchViewState(): CommitSearchViewState {
  const fallback: CommitSearchViewState = {
    author: "",
    branch: "",
    fromDate: "",
    organizationId: "",
    projectId: "",
    query: "",
    repositoryId: "",
    toDate: "",
  };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMIT_SEARCH_VIEW_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    return {
      author: typeof parsed.author === "string" ? parsed.author : "",
      branch: typeof parsed.branch === "string" ? parsed.branch : "",
      fromDate: typeof parsed.fromDate === "string" ? parsed.fromDate : "",
      organizationId: typeof parsed.organizationId === "string" ? parsed.organizationId : "",
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      query: typeof parsed.query === "string" ? parsed.query : "",
      repositoryId: typeof parsed.repositoryId === "string" ? parsed.repositoryId : "",
      toDate: typeof parsed.toDate === "string" ? parsed.toDate : "",
    };
  } catch {
    return fallback;
  }
}

function storeCommitSearchViewState(state: CommitSearchViewState) {
  window.localStorage.setItem(COMMIT_SEARCH_VIEW_STORAGE_KEY, JSON.stringify(state));
}

type CommitViewMode = "results" | "activity";

function loadCommitViewMode(): CommitViewMode {
  return window.localStorage.getItem(COMMIT_VIEW_MODE_STORAGE_KEY) === "activity"
    ? "activity"
    : "results";
}

export function CommitSearch({
  organizations,
  externalSearch,
  onExternalSearchHandled,
  onOpenPullRequest,
}: {
  organizations: Organization[];
  externalSearch?: { query: string; requestId: number; organizationId?: string } | null;
  onExternalSearchHandled?: () => void;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
}) {
  const initialViewState = useMemo(() => loadCommitSearchViewState(), []);
  const [organizationId, setOrganizationId] = useState(() =>
    organizations.some((organization) => organization.id === initialViewState.organizationId)
      ? initialViewState.organizationId
      : organizations[0]?.id ?? "",
  );
  const [query, setQuery] = useState(initialViewState.query);
  const [author, setAuthor] = useState(initialViewState.author);
  const [branch, setBranch] = useState(initialViewState.branch);
  const [fromDate, setFromDate] = useState(initialViewState.fromDate);
  const [toDate, setToDate] = useState(initialViewState.toDate);
  const [projectId, setProjectId] = useState(initialViewState.projectId);
  const [repositoryId, setRepositoryId] = useState(initialViewState.repositoryId);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CommitViewMode>(() => loadCommitViewMode());

  const mutation = useMutation({
    mutationFn: searchCommits,
  });

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const repositoriesQuery = useQuery({
    queryKey: ["commitRepositories", selectedOrganizationId],
    queryFn: () => listCommitRepositories({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const repositoryOptions = repositoriesQuery.data ?? [];
  const projectOptions = useMemo(() => uniqueCommitProjects(repositoryOptions), [repositoryOptions]);
  const filteredRepositoryOptions = useMemo(
    () =>
      projectId
        ? repositoryOptions.filter((repository) => repository.projectId === projectId)
        : repositoryOptions,
    [projectId, repositoryOptions],
  );
  const results = mutation.data ?? [];
  const activeSearchFilterCount =
    (query.trim() ? 1 : 0) +
    (author.trim() ? 1 : 0) +
    (branch.trim() ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0) +
    (projectId ? 1 : 0) +
    (repositoryId ? 1 : 0);

  useEffect(() => {
    if (!organizationId && organizations[0]) {
      setOrganizationId(organizations[0].id);
    }
  }, [organizationId, organizations]);

  useEffect(() => {
    storeCommitSearchViewState({
      author,
      branch,
      fromDate,
      organizationId: selectedOrganizationId,
      projectId,
      query,
      repositoryId,
      toDate,
    });
  }, [author, branch, fromDate, projectId, query, repositoryId, selectedOrganizationId, toDate]);

  useEffect(() => {
    window.localStorage.setItem(COMMIT_VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (
      repositoryId &&
      !filteredRepositoryOptions.some((repository) => repository.repositoryId === repositoryId)
    ) {
      setRepositoryId("");
    }
  }, [filteredRepositoryOptions, repositoryId]);

  useEffect(() => {
    if (!externalSearch) return;
    const targetOrganizationId = externalSearch.organizationId ?? selectedOrganizationId;
    mutation.reset();
    setOrganizationId(targetOrganizationId);
    setQuery(externalSearch.query);
    setAuthor("");
    setBranch("");
    setFromDate("");
    setToDate("");
    setProjectId("");
    setRepositoryId("");
    setValidationError(null);
    mutation.mutate({
      organizationId: targetOrganizationId,
      query: externalSearch.query,
      author: "",
      branch: "",
      fromDate: "",
      toDate: "",
      projectId: "",
      repositoryId: "",
    });
    onExternalSearchHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch?.requestId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.reset();
    if (fromDate && toDate && fromDate > toDate) {
      setValidationError("From date must be before or equal to To date.");
      return;
    }
    if (branch.trim() && !repositoryId) {
      setValidationError("Select a repository to search a specific branch.");
      return;
    }
    setValidationError(null);
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query,
      author,
      branch,
      fromDate,
      toDate,
      projectId,
      repositoryId,
    });
  }

  function clearSearchFilters() {
    setQuery("");
    setAuthor("");
    setBranch("");
    setFromDate("");
    setToDate("");
    setProjectId("");
    setRepositoryId("");
    setValidationError(null);
    if (mutation.isSuccess) {
      mutation.mutate({
        organizationId: selectedOrganizationId,
        query: "",
        author: "",
        branch: "",
        fromDate: "",
        toDate: "",
        projectId: "",
        repositoryId: "",
      });
    }
  }

  const currentPayload: CommitSearchPayload = {
    organizationId: selectedOrganizationId,
    query,
    author,
    branch,
    fromDate,
    toDate,
    projectId,
    repositoryId,
  };

  function applySavedSearch(payload: CommitSearchPayload) {
    const targetOrganizationId =
      payload.organizationId && organizations.some((o) => o.id === payload.organizationId)
        ? payload.organizationId
        : selectedOrganizationId;
    if (payload.organizationId) setOrganizationId(targetOrganizationId);
    setQuery(payload.query);
    setAuthor(payload.author);
    setBranch(payload.branch);
    setFromDate(payload.fromDate);
    setToDate(payload.toDate);
    setProjectId(payload.projectId);
    setRepositoryId(payload.repositoryId);
    setValidationError(null);
    mutation.mutate({
      organizationId: targetOrganizationId,
      query: payload.query,
      author: payload.author,
      branch: payload.branch,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      projectId: payload.projectId,
      repositoryId: payload.repositoryId,
    });
  }

  useApplySearchPreset<CommitSearchPayload>("commit", applySavedSearch);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-card">
        <form className="grid gap-3 p-3" onSubmit={onSubmit}>
          <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_180px_180px_170px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="message, author, repository, SHA"
                  aria-label="Filter"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={selectedOrganizationId}
                onChange={(event) => {
                  setOrganizationId(event.target.value);
                  setProjectId("");
                  setRepositoryId("");
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Author</span>
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="email or name"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !selectedOrganizationId}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="h-4 w-4" aria-hidden="true" />
                )}
                Search
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[150px_150px_auto_220px_240px_1fr]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="grid gap-2">
              <span className="text-sm font-medium text-muted-foreground">Preset</span>
              <div className="flex items-center gap-1">
                {([7, 30, 90] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => {
                      const fmt = (d: Date) =>
                        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                      const to = new Date();
                      const from = new Date();
                      from.setDate(from.getDate() - days);
                      setFromDate(fmt(from));
                      setToDate(fmt(to));
                    }}
                    className="inline-flex h-9 items-center rounded-md border border-input bg-background px-2.5 text-xs hover:bg-muted"
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <select
                value={projectId}
                disabled={repositoriesQuery.isLoading || repositoryOptions.length === 0}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setRepositoryId("");
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">All projects</option>
                {projectOptions.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <select
                value={repositoryId}
                disabled={repositoriesQuery.isLoading || filteredRepositoryOptions.length === 0}
                onChange={(event) => setRepositoryId(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">All repositories</option>
                {filteredRepositoryOptions.map((repository) => (
                  <option
                    key={`${repository.projectId}:${repository.repositoryId}`}
                    value={repository.repositoryId}
                  >
                    {projectId
                      ? repository.repositoryName
                      : `${repository.projectName} / ${repository.repositoryName}`}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <p className="pb-2 text-xs text-muted-foreground">
                {repositoriesQuery.isLoading
                  ? "Loading project filters"
                  : repositoriesQuery.isError
                    ? "Project filters unavailable"
                    : `${repositoryOptions.length} repositories available`}
              </p>
            </div>
          </div>

          {validationError ? (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          ) : null}
        </form>
      </div>

      <SavedSearchBar kind="commit" currentPayload={currentPayload} onApply={applySavedSearch} />

      <div className="flex items-center justify-between gap-3">
        <CommitViewToggle value={viewMode} onChange={setViewMode} />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Showing locally synced data — refreshed automatically every 5 minutes.
        </p>
      </div>

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      {viewMode === "activity" ? (
        <CommitActivityHeatmap
          organizationId={selectedOrganizationId}
          author={author}
          fromDate={fromDate}
          toDate={toDate}
          projectId={projectId}
          repositoryId={repositoryId}
        />
      ) : (
        <CommitResults
          activeExternalFilterCount={activeSearchFilterCount}
          loading={mutation.isPending}
          onClearExternalFilters={clearSearchFilters}
          onOpenPullRequest={onOpenPullRequest}
          results={results}
          searched={mutation.isSuccess}
        />
      )}
    </div>
  );
}

function CommitViewToggle({
  value,
  onChange,
}: {
  value: CommitViewMode;
  onChange: (mode: CommitViewMode) => void;
}) {
  const tabs: { id: CommitViewMode; label: string }[] = [
    { id: "results", label: "Results" },
    { id: "activity", label: "Activity" },
  ];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: ReactKeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + tabs.length) % tabs.length;
    else return;
    event.preventDefault();
    const target = tabs[next];
    onChange(target.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Commit view" className="inline-flex rounded-md border border-border bg-card p-0.5">
      {tabs.map((tab, index) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`rounded px-3 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ${
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function uniqueCommitProjects(repositories: CommitRepositoryOption[]) {
  const projects = new Map<string, { projectId: string; projectName: string }>();
  for (const repository of repositories) {
    projects.set(repository.projectId, {
      projectId: repository.projectId,
      projectName: repository.projectName,
    });
  }
  return [...projects.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
}

type CommitSortKey = "date" | "repository" | "author" | "comment";
type CommitSortState = { key: CommitSortKey; direction: "asc" | "desc" };

const commitSortLabels: Record<CommitSortKey, string> = {
  date: "Date",
  comment: "Message",
  repository: "Repository",
  author: "Author",
};

const COMMIT_GRID_KEYS: CommitSortKey[] = ["date", "comment", "repository", "author"];

function defaultCommitSortDir(key: CommitSortKey): "asc" | "desc" {
  return key === "date" ? "desc" : "asc";
}

function loadCommitSort(): CommitSortState {
  const fallback: CommitSortState = { key: "date", direction: "desc" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMIT_SORT_STORAGE_KEY) ?? "null");
    if (
      !parsed ||
      !COMMIT_GRID_KEYS.includes(parsed.key) ||
      (parsed.direction !== "asc" && parsed.direction !== "desc")
    ) {
      return fallback;
    }
    return { key: parsed.key, direction: parsed.direction };
  } catch {
    return fallback;
  }
}

function compareCommitsByKey(a: CommitSummary, b: CommitSummary, key: CommitSortKey): number {
  switch (key) {
    case "date":
      return (a.authorDate ?? "").localeCompare(b.authorDate ?? "");
    case "repository":
      return `${a.projectName}/${a.repositoryName}`.localeCompare(`${b.projectName}/${b.repositoryName}`);
    case "author":
      return (a.authorName ?? "").localeCompare(b.authorName ?? "");
    case "comment":
      return a.comment.localeCompare(b.comment);
  }
}

function CommitSortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
}: {
  column: CommitSortKey;
  sort: CommitSortState;
  onSort: (column: CommitSortKey) => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort.key === column;
  const label = commitSortLabels[column];
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className="relative min-w-0"
    >
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        onClick={() => onSort(column)}
        className={`flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
          active ? "text-foreground" : ""
        }`}
      >
        <span className="truncate">{label}</span>
        {active ? (
          sort.direction === "asc" ? (
            <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          )
        ) : (
          <span className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
      </button>
      {resizeHandle}
    </div>
  );
}

// Cells stay direct grid items (keyed Fragment) so the column template lines up.
function renderCommitCell(key: CommitColumnKey, commit: CommitSummary, prCount: number): ReactNode {
  switch (key) {
    case "sha":
      return (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (commit.webUrl) openExternalUrl(commit.webUrl); }}
          className="truncate text-left font-mono text-xs text-primary hover:underline"
          title={commit.commitId}
        >
          {commit.shortCommitId}
        </button>
      );
    case "date":
      return (
        <span
          className="text-xs text-muted-foreground"
          title={commit.authorDate ? formatDate(commit.authorDate) : undefined}
        >
          {commit.authorDate ? formatRelativeDate(commit.authorDate) : "—"}
        </span>
      );
    case "comment": {
      const message = commit.comment.split(/\r?\n/, 1)[0] || "(no comment)";
      return (
        <span className="truncate font-medium text-foreground" title={commit.comment}>
          {message}
        </span>
      );
    }
    case "repository":
      return (
        <span className="truncate text-xs text-muted-foreground" title={`${commit.projectName} / ${commit.repositoryName}`}>
          {commit.projectName} / {commit.repositoryName}
        </span>
      );
    case "author":
      return (
        <span className="truncate text-xs text-muted-foreground" title={commit.authorName ?? undefined}>
          {commit.authorName ?? "—"}
        </span>
      );
    case "pr":
      return (
        <span className="flex items-center justify-center" aria-hidden={prCount === 0}>
          {prCount > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 text-primary"
              title={`In ${prCount} pull request${prCount === 1 ? "" : "s"}`}
              aria-label={`In ${prCount} pull request${prCount === 1 ? "" : "s"}`}
            >
              <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-[11px] tabular-nums">{prCount}</span>
            </span>
          ) : null}
        </span>
      );
  }
}

const CommitGridRow = forwardRef<
  HTMLDivElement,
  {
    commit: CommitSummary;
    selected: boolean;
    columnTemplate: string;
    visibleColumns: CommitColumnKey[];
    onSelect: () => void;
  }
>(({ commit, selected, columnTemplate, visibleColumns, onSelect }, ref) => {
  // Reflects the related-PR lookup that the preview triggers on selection;
  // reads cached query data only, so the grid never fans out N requests.
  const prQuery = useQuery({
    queryKey: commitPrQueryKey(commit),
    queryFn: () => getCommitPullRequests(commit),
    enabled: false,
  });
  const prCount = prQuery.data?.length ?? 0;
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter") {
          e.stopPropagation();
          if (e.ctrlKey && commit.webUrl) openExternalUrl(commit.webUrl);
          else focusPrimaryPreview();
        }
      }}
      className={`grid h-[29px] cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {visibleColumns.map((key) => (
        <Fragment key={key}>{renderCommitCell(key, commit, prCount)}</Fragment>
      ))}
    </div>
  );
});
CommitGridRow.displayName = "CommitGridRow";

// Lists the PRs that contain the selected commit. This is the query that
// actually fetches; the grid indicator reads the same cache passively. Renders
// nothing when the commit is in no PRs (per the issue's "hide if none" rule).
function CommitRelatedPrsPanel({
  commit,
  onOpenPullRequest,
}: {
  commit: CommitSummary;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
}) {
  const prsQuery = useQuery({
    queryKey: commitPrQueryKey(commit),
    queryFn: () => getCommitPullRequests(commit),
    staleTime: 5 * 60_000,
  });

  if (prsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading related pull
        requests…
      </div>
    );
  }
  if (prsQuery.isError) {
    return (
      <p className="border-t border-border px-3 py-2 text-xs text-destructive">
        {commandErrorMessage(prsQuery.error)}
      </p>
    );
  }
  const prs = prsQuery.data ?? [];
  if (prs.length === 0) return null;

  function openPr(pr: CommitPullRequest) {
    onOpenPullRequest?.(String(pr.pullRequestId), commit.organizationId);
  }

  return (
    <div className="border-t border-border">
      <div className="border-b border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {prs.length} related pull request{prs.length === 1 ? "" : "s"}
      </div>
      <ul>
        {prs.map((pr) => (
          <li key={pr.pullRequestId}>
            <button
              type="button"
              onClick={() => openPr(pr)}
              onKeyDown={(event) => {
                // Keep Enter/Space on the button; don't let the preview's
                // Esc/Arrow handler hijack activation.
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 focus:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              title={`Open !${pr.pullRequestId} in Pull Request search`}
            >
              <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="shrink-0 font-mono text-muted-foreground">!{pr.pullRequestId}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{pr.title}</span>
              <span
                className={`shrink-0 rounded border px-1 py-px text-[10px] font-semibold ${prStatusBadgeClass(pr.status)}`}
              >
                {PR_STATUS_LABELS[pr.status.toLowerCase()] ?? pr.status}
              </span>
              {pr.myVote !== 0 ? (
                <span className="shrink-0 text-[10px] text-muted-foreground" title="Your vote">
                  {pr.myVoteLabel}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommitPreviewPanel({
  commit,
  maximized,
  onToggleMaximize,
  onOpenPullRequest,
}: {
  commit: CommitSummary | null;
  maximized: boolean;
  onToggleMaximize: () => void;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
}) {
  // Esc / ← step back to the grid (mirrors the grid's Enter / → into here).
  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  return (
    <aside
      onKeyDown={handleKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        {commit ? (
          <span className="shrink-0 font-mono text-xs font-semibold text-primary" title={commit.commitId}>
            {commit.shortCommitId}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No commit selected</span>
        )}
        {commit?.webUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(commit.webUrl as string)}
            title="Open in Azure DevOps (O)"
            className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-px text-[11px] text-primary hover:bg-secondary"
          >
            Open
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleMaximize}
          aria-pressed={maximized}
          aria-label={maximized ? "Restore split view" : "Maximize preview"}
          title={`${maximized ? "Restore split view" : "Maximize preview"} (\\)`}
          className={`shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
            commit?.webUrl ? "" : "ml-auto"
          }`}
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        data-primary-preview="true"
        aria-keyshortcuts="Alt+P"
        tabIndex={-1}
      >
        {commit ? (
          <>
            <div className="px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {commit.comment || "(no comment)"}
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>Author</dt>
                <dd className="text-foreground">
                  {commit.authorName ?? "—"}
                  {commit.authorEmail ? ` <${commit.authorEmail}>` : ""}
                </dd>
                <dt>Date</dt>
                <dd className="text-foreground">
                  {commit.authorDate ? formatDate(commit.authorDate) : "—"}
                </dd>
                <dt>Repository</dt>
                <dd className="text-foreground">
                  {commit.projectName} / {commit.repositoryName}
                </dd>
                <dt>Commit</dt>
                <dd className="break-all font-mono text-foreground">{commit.commitId}</dd>
              </dl>
            </div>
            <CommitRelatedPrsPanel commit={commit} onOpenPullRequest={onOpenPullRequest} />
            <CommitFilesPanel
              key={`${commit.organizationId}:${commit.repositoryId}:${commit.commitId}`}
              organizationId={commit.organizationId}
              projectId={commit.projectId}
              repositoryId={commit.repositoryId}
              commitId={commit.commitId}
              commitWebUrl={commit.webUrl}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-sm text-muted-foreground">
            Select a commit.
          </div>
        )}
      </div>
    </aside>
  );
}

function CommitResults({
  activeExternalFilterCount = 0,
  loading,
  onClearExternalFilters,
  onOpenPullRequest,
  results,
  searched,
}: {
  activeExternalFilterCount?: number;
  loading: boolean;
  onClearExternalFilters?: () => void;
  onOpenPullRequest?: (query: string, organizationId?: string) => void;
  results: CommitSummary[];
  searched: boolean;
}) {
  const [sort, setCommitSort] = useState<CommitSortState>(() => loadCommitSort());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(COMMIT_COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_COMMIT_COLUMN_WIDTHS, COMMIT_COLUMN_MIN_WIDTHS, COMMIT_COLUMN_MAX_WIDTHS),
  );
  const [visibleColumns, setVisibleColumns] = useState<CommitColumnKey[]>(
    loadCommitVisibleColumns,
  );
  const [columnMenuRect, setColumnMenuRect] = useState<DOMRect | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      COMMIT_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_COMMIT_PREVIEW_WIDTH,
      MIN_COMMIT_PREVIEW_WIDTH,
      MAX_COMMIT_PREVIEW_WIDTH,
    ),
  );
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const restoreFocusRef = useRef(false);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [gridViewport, setGridViewport] = useState({ height: 0, scrollTop: 0 });

  useEffect(() => {
    localStorage.setItem(COMMIT_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    localStorage.setItem(COMMIT_PREVIEW_WIDTH_STORAGE_KEY, String(Math.round(previewWidth)));
  }, [previewWidth]);

  useEffect(() => {
    if (!scrollerEl) return;

    function updateViewport() {
      setGridViewport({
        height: scrollerEl!.clientHeight,
        scrollTop: scrollerEl!.scrollTop,
      });
    }

    updateViewport();
    scrollerEl.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateViewport);
    resizeObserver?.observe(scrollerEl);
    return () => {
      scrollerEl.removeEventListener("scroll", updateViewport);
      resizeObserver?.disconnect();
    };
  }, [scrollerEl]);

  useEffect(() => {
    localStorage.setItem(COMMIT_SORT_STORAGE_KEY, JSON.stringify(sort));
  }, [sort]);

  useEffect(() => {
    localStorage.setItem(COMMIT_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  function toggleColumnVisibility(column: CommitColumnKey) {
    if (COMMIT_REQUIRED_COLUMNS.includes(column)) return;
    setVisibleColumns((current) =>
      current.includes(column)
        ? current.filter((value) => value !== column)
        : COMMIT_COLUMN_KEYS.filter((value) => value === column || current.includes(value)),
    );
  }

  function resetColumnVisibility() {
    setVisibleColumns([...COMMIT_COLUMN_KEYS]);
  }

  // Width array is indexed by the full column order; pick out the visible ones
  // and keep the message column as the flexible one.
  const visibleColumnWidths = visibleColumns.map(
    (column) => columnWidths[COMMIT_COLUMN_KEYS.indexOf(column)],
  );
  const messageFlexIndex = Math.max(0, visibleColumns.indexOf("comment"));
  const commitColTemplate = gridColumnTemplate(visibleColumnWidths, messageFlexIndex);

  const sorted = useMemo(() => {
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...results].sort((a, b) => {
      const primary = compareCommitsByKey(a, b, sort.key);
      if (primary !== 0) return primary * dir;
      return `${a.repositoryId}:${a.commitId}`.localeCompare(`${b.repositoryId}:${b.commitId}`);
    });
  }, [results, sort]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(sorted.length - 1, 0)));
  }, [sorted.length]);

  function applySort(key: CommitSortKey) {
    setCommitSort((current) => {
      if (current.key !== key) return { key, direction: defaultCommitSortDir(key) };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
    setSelectedIndex(0);
  }

  function scrollRowIntoView(index: number) {
    if (!scrollerEl) return;
    const rowTop = index * COMMIT_GRID_ROW_HEIGHT;
    const rowBottom = rowTop + COMMIT_GRID_ROW_HEIGHT;
    if (rowTop < scrollerEl.scrollTop) {
      scrollerEl.scrollTop = rowTop;
    } else if (rowBottom > scrollerEl.scrollTop + scrollerEl.clientHeight) {
      scrollerEl.scrollTop = rowBottom - scrollerEl.clientHeight;
    }
  }

  function moveSelectionTo(index: number) {
    const next = clamp(index, 0, sorted.length - 1);
    restoreFocusRef.current = true;
    scrollRowIntoView(next);
    setSelectedIndex(next);
  }

  function moveSelection(delta: number) {
    moveSelectionTo(selectedIndex + delta);
  }

  // Rows outside the virtual window unmount, so roving focus is restored once
  // the row for the new selection is mounted again.
  useEffect(() => {
    if (!restoreFocusRef.current) return;
    const row = rowRefs.current[selectedIndex];
    if (!row) return;
    restoreFocusRef.current = false;
    row.focus({ preventScroll: true });
  });

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    // Single-letter shortcuts must not swallow app-level chords (Ctrl+K etc.);
    // Ctrl+Enter stays grid-handled to open in Azure DevOps.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "Enter") {
        e.preventDefault();
        const commit = sorted[selectedIndex];
        if (commit?.webUrl) openExternalUrl(commit.webUrl);
      }
      return;
    }
    if (e.key === "/") { e.preventDefault(); focusFilterInput(); return; }
    if (e.key === "\\") { e.preventDefault(); setMaximized((value) => !value); return; }
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Home") { e.preventDefault(); moveSelectionTo(0); }
    else if (e.key === "End") { e.preventDefault(); moveSelectionTo(sorted.length - 1); }
    else if (e.key === "PageDown") { e.preventDefault(); moveSelection(10); }
    else if (e.key === "PageUp") { e.preventDefault(); moveSelection(-10); }
    else if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); focusPrimaryPreview(); }
    else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      const commit = sorted[selectedIndex];
      if (commit?.webUrl) openExternalUrl(commit.webUrl);
    } else if (e.key === "c" || e.key === "C") {
      const commit = sorted[selectedIndex];
      if (commit?.webUrl) {
        void navigator.clipboard.writeText(commit.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    }
  }

  const countLabel = useMemo(() => {
    if (loading) return "Searching";
    if (!searched) return "Ready";
    return `${results.length} commit${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length, searched]);
  const activeFilterCount = Math.max(0, activeExternalFilterCount);

  const firstVirtualRow = Math.max(
    0,
    Math.floor(gridViewport.scrollTop / COMMIT_GRID_ROW_HEIGHT) - COMMIT_GRID_OVERSCAN,
  );
  const visibleRowCount = Math.ceil(
    Math.max(gridViewport.height, COMMIT_GRID_ROW_HEIGHT) / COMMIT_GRID_ROW_HEIGHT,
  );
  const lastVirtualRow = Math.min(
    sorted.length,
    firstVirtualRow + visibleRowCount + COMMIT_GRID_OVERSCAN * 2,
  );
  const virtualRows = sorted.slice(firstVirtualRow, lastVirtualRow);
  const virtualTopPadding = firstVirtualRow * COMMIT_GRID_ROW_HEIGHT;
  const virtualBottomPadding =
    Math.max(0, sorted.length - lastVirtualRow) * COMMIT_GRID_ROW_HEIGHT;

  const selectedCommit = sorted[selectedIndex] ?? null;

  return (
    <div
      className={
        maximized
          ? "flex min-h-0 flex-1"
          : "grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(320px,var(--commit-preview-width))]"
      }
      style={{ "--commit-preview-width": `${previewWidth}px` } as CSSProperties}
    >
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card ${
          maximized ? "hidden" : ""
        }`}
      >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {countLabel}
          <ActiveFilters count={activeFilterCount} onClear={onClearExternalFilters ?? (() => {})} />
          <button
            type="button"
            onClick={(event) => setColumnMenuRect(event.currentTarget.getBoundingClientRect())}
            className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
          >
            Columns
          </button>
        </span>
      </div>
      {!searched && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Run a search to load commits.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          No commits matched.
        </div>
      ) : (
        <div
          role="grid"
          aria-label="Commit search results"
          data-primary-grid="true"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col outline-none"
          onKeyDown={handleKeyDown}
        >
          <div ref={setScrollerEl} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="min-w-[724px]">
            <div
              role="row"
              className="grid items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ gridTemplateColumns: commitColTemplate }}
            >
              {visibleColumns.map((col, i) => {
                const fullIndex = COMMIT_COLUMN_KEYS.indexOf(col);
                const isLast = i === visibleColumns.length - 1;
                const resizeHandle = isLast ? undefined : (
                  <ColumnResizeHandle
                    columnIndex={fullIndex}
                    widths={columnWidths}
                    setWidths={setColumnWidths}
                    min={COMMIT_COLUMN_MIN_WIDTHS[fullIndex]}
                    max={COMMIT_COLUMN_MAX_WIDTHS[fullIndex]}
                    defaultWidth={DEFAULT_COMMIT_COLUMN_WIDTHS[fullIndex]}
                  />
                );
                if (col === "sha") {
                  return (
                    <div key={col} role="columnheader" className="relative min-w-0 truncate px-1">
                      SHA
                      {resizeHandle}
                    </div>
                  );
                }
                if (col === "pr") {
                  return (
                    <div
                      key={col}
                      role="columnheader"
                      className="relative min-w-0 truncate px-1 text-center"
                      title="Pull requests containing this commit"
                    >
                      PR
                      {resizeHandle}
                    </div>
                  );
                }
                return (
                  <CommitSortHeaderButton
                    key={col}
                    column={col}
                    sort={sort}
                    onSort={applySort}
                    resizeHandle={resizeHandle}
                  />
                );
              })}
            </div>
            {loading ? (
              <LoadingState />
            ) : (
              <>
                {virtualTopPadding > 0 ? <div style={{ height: virtualTopPadding }} /> : null}
                {virtualRows.map((commit, offset) => {
                  const index = firstVirtualRow + offset;
                  return (
                    <CommitGridRow
                      key={`${commit.repositoryId}:${commit.commitId}`}
                      ref={(el) => { rowRefs.current[index] = el; }}
                      commit={commit}
                      selected={index === selectedIndex}
                      columnTemplate={commitColTemplate}
                      visibleColumns={visibleColumns}
                      onSelect={() => setSelectedIndex(index)}
                    />
                  );
                })}
                {virtualBottomPadding > 0 ? <div style={{ height: virtualBottomPadding }} /> : null}
              </>
            )}
          </div>
          </div>
        </div>
      )}
      </div>

      <ResizeHandle
        ariaLabel="Resize commit preview"
        className={maximized ? "hidden" : "hidden xl:flex"}
        direction={-1}
        max={MAX_COMMIT_PREVIEW_WIDTH}
        min={MIN_COMMIT_PREVIEW_WIDTH}
        onChange={setPreviewWidth}
        onReset={() => setPreviewWidth(DEFAULT_COMMIT_PREVIEW_WIDTH)}
        value={previewWidth}
      />

      <CommitPreviewPanel
        commit={selectedCommit}
        maximized={maximized}
        onToggleMaximize={() => setMaximized((value) => !value)}
        onOpenPullRequest={onOpenPullRequest}
      />

      {copyToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
          {copyToast}
        </div>
      )}
      {columnMenuRect ? (
        <ColumnVisibilityMenu
          anchorRect={columnMenuRect}
          columns={COMMIT_COLUMN_KEYS.map((key) => ({ key, label: COMMIT_COLUMN_LABELS[key] }))}
          visibleColumns={visibleColumns}
          requiredColumns={COMMIT_REQUIRED_COLUMNS}
          onToggle={toggleColumnVisibility}
          onReset={resetColumnVisibility}
          onClose={() => setColumnMenuRect(null)}
        />
      ) : null}
    </div>
  );
}
