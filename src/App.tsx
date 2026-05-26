import {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  FileText,
  GitCommitHorizontal,
  GripVertical,
  Eye,
  EyeOff,
  GitPullRequest,
  Keyboard,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { Route, Routes } from "react-router-dom";
import {
  addAzureCliOrganization,
  addPatOrganization,
  commandErrorMessage,
  deleteOrganization,
  getAppSettings,
  getReviewResultPreview,
  listCommitRepositories,
  listMyReviewPullRequests,
  listMyWorkItems,
  listOrganizations,
  searchCommits,
  searchPullRequests,
  searchWorkItems,
  updateAppSettings,
  type AppSettings,
  type CommitRepositoryOption,
  type CommitSummary,
  type Organization,
  type PullRequestSummary,
  type ReviewPullRequestSummary,
  type ReviewResultPreview,
  type SearchPullRequestsInput,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";

type View = "pullRequestSearch" | "myReviews" | "workItems" | "myWorkItems" | "commits" | "settings";

const DEFAULT_SIDEBAR_WIDTH = 256;
const DEFAULT_REVIEW_PREVIEW_WIDTH = 420;
const DEFAULT_PR_GRID_COLUMN_WIDTHS = [64, 220, 360, 112, 64, 112, 80, 112];
const PR_GRID_COLUMN_MIN_WIDTHS = [56, 160, 220, 96, 56, 96, 72, 96];
const PR_GRID_COLUMN_MAX_WIDTHS = [120, 520, 960, 240, 120, 240, 180, 240];
const SIDEBAR_WIDTH_STORAGE_KEY = "azdodeck:layout:sidebarWidth";
const REVIEW_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:reviewPreviewWidth";
const PR_GRID_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:myReviewsGridColumnWidths";
const DEFAULT_PR_SEARCH_COLUMN_WIDTHS = [72, 88, 340, 180, 140, 80, 180];
const PR_SEARCH_COLUMN_MIN_WIDTHS = [56, 70, 200, 120, 100, 64, 120];
const PR_SEARCH_COLUMN_MAX_WIDTHS = [120, 140, 720, 360, 280, 120, 360];
const PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:prSearchGridColumnWidths";
const DEFAULT_WI_COLUMN_WIDTHS = [72, 120, 100, 340, 160, 140, 100];
const WI_COLUMN_MIN_WIDTHS = [56, 90, 80, 200, 120, 100, 80];
const WI_COLUMN_MAX_WIDTHS = [120, 200, 180, 720, 300, 260, 160];
const WI_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:wiSearchGridColumnWidths";
const DEFAULT_COMMIT_COLUMN_WIDTHS = [88, 96, 360, 200, 180];
const COMMIT_COLUMN_MIN_WIDTHS = [72, 80, 200, 140, 120];
const COMMIT_COLUMN_MAX_WIDTHS = [140, 160, 720, 380, 340];
const COMMIT_COLUMN_WIDTHS_STORAGE_KEY = "azdodeck:layout:commitGridColumnWidths";

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return !!element?.closest("input, textarea, select, [contenteditable='true']");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function storedNumber(key: string, fallback: number, min: number, max: number): number {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function storedNumbers(key: string, fallback: number[], mins: number[], maxs: number[]): number[] {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return [...fallback];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== fallback.length) {
      return [...fallback];
    }

    return fallback.map((defaultValue, index) => {
      const parsedValue = Number(parsed[index]);
      if (!Number.isFinite(parsedValue)) {
        return defaultValue;
      }
      return clamp(parsedValue, mins[index], maxs[index]);
    });
  } catch {
    return [...fallback];
  }
}

function beginHorizontalResize(
  event: ReactPointerEvent,
  options: {
    value: number;
    min: number;
    max: number;
    direction: 1 | -1;
    onChange: (value: number) => void;
  },
) {
  event.preventDefault();
  const startX = event.clientX;
  const startValue = options.value;

  function onPointerMove(moveEvent: PointerEvent) {
    const delta = (moveEvent.clientX - startX) * options.direction;
    options.onChange(clamp(startValue + delta, options.min, options.max));
  }

  function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function AppShell() {
  const [view, setView] = useState<View>("myReviews");
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedNumber(SIDEBAR_WIDTH_STORAGE_KEY, DEFAULT_SIDEBAR_WIDTH, 220, 420),
  );
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
  });

  const organizations = organizationsQuery.data ?? [];
  const activeView = organizations.length === 0 ? "settings" : view;

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(sidebarWidth)));
  }, [sidebarWidth]);

  useEffect(() => {
    function onGlobalKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === "?" && !event.altKey && !isEditableTarget(event.target)) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      if (event.key === "Escape" && !event.altKey) {
        setHelpOpen(false);
        return;
      }

      if (!event.altKey || event.shiftKey) {
        return;
      }

      const nextViewByKey: Record<string, View> =
        organizations.length === 0
          ? { "6": "settings" }
          : {
              "1": "myReviews",
              "2": "pullRequestSearch",
              "3": "myWorkItems",
              "4": "workItems",
              "5": "commits",
              "6": "settings",
            };
      const nextView = nextViewByKey[event.key];
      if (!nextView) {
        return;
      }

      event.preventDefault();
      setView(nextView);
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [organizations.length]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside
        className="fixed inset-y-0 left-0 hidden flex-col border-r border-border bg-white lg:flex"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">AzDoDeck</p>
            <p className="text-xs text-muted-foreground">Azure DevOps</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col p-3">
          <div className="space-y-1">
            {/* Pull Requests section */}
            <NavSection
              icon={<GitPullRequest className="h-4 w-4" aria-hidden="true" />}
              label="Pull Requests"
              disabled={organizations.length === 0}
            >
              <NavSubItem
                active={activeView === "myReviews"}
                disabled={organizations.length === 0}
                label="My Reviews"
                shortcut="Alt+1"
                onClick={() => setView("myReviews")}
              />
              <NavSubItem
                active={activeView === "pullRequestSearch"}
                disabled={organizations.length === 0}
                label="Search"
                shortcut="Alt+2"
                onClick={() => setView("pullRequestSearch")}
              />
            </NavSection>
            <NavSection
              icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
              label="Work Items"
              disabled={organizations.length === 0}
            >
              <NavSubItem
                active={activeView === "myWorkItems"}
                disabled={organizations.length === 0}
                label="My Items"
                shortcut="Alt+3"
                onClick={() => setView("myWorkItems")}
              />
              <NavSubItem
                active={activeView === "workItems"}
                disabled={organizations.length === 0}
                label="Search"
                shortcut="Alt+4"
                onClick={() => setView("workItems")}
              />
            </NavSection>
            <NavButton
              active={activeView === "commits"}
              disabled={organizations.length === 0}
              icon={<GitCommitHorizontal className="h-4 w-4" aria-hidden="true" />}
              label="Commits"
              shortcut="Alt+5"
              onClick={() => setView("commits")}
            />
          </div>
          <div className="mt-auto border-t border-border pt-3">
            <NavButton
              active={activeView === "settings"}
              icon={<Settings className="h-4 w-4" aria-hidden="true" />}
              label="Settings"
              shortcut="Alt+6"
              onClick={() => setView("settings")}
            />
          </div>
        </nav>
        <ResizeHandle
          ariaLabel="Resize navigation"
          className="absolute inset-y-0 right-[-5px] hidden lg:flex"
          direction={1}
          max={420}
          min={220}
          onChange={setSidebarWidth}
          onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
          value={sidebarWidth}
        />
      </aside>

      <main className="lg:pl-[var(--sidebar-width)]" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
        <header className="flex h-16 items-center justify-between border-b border-border bg-white px-5 lg:px-8">
          <div>
            <h1 className="text-lg font-semibold">
              {activeView === "pullRequestSearch"
                ? "Pull Requests"
                : activeView === "myReviews"
                  ? "My Reviews"
                  : activeView === "workItems"
                    ? "Work Items"
                    : activeView === "myWorkItems"
                      ? "My Work Items"
                      : activeView === "commits"
                        ? "Commits"
                        : "Settings"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeView === "pullRequestSearch"
                ? "Search Azure DevOps pull requests across projects and repositories"
                : activeView === "myReviews"
                  ? "Pull requests assigned to you for review"
                  : activeView === "workItems"
                    ? "Search Azure DevOps work items across projects"
                    : activeView === "myWorkItems"
                      ? "Work items assigned to you"
                      : activeView === "commits"
                        ? "Search Azure DevOps commits across repositories"
                        : "Local Azure DevOps organization setup"}
            </p>
          </div>
        </header>

        <section className="w-full px-5 py-8 lg:px-8">
          {organizationsQuery.isLoading ? (
            <LoadingState />
          ) : organizationsQuery.isError ? (
            <ErrorState message={commandErrorMessage(organizationsQuery.error)} />
          ) : activeView === "pullRequestSearch" ? (
            <PullRequestSearch organizations={organizations} />
          ) : activeView === "myReviews" ? (
            <MyReviewsGrid organizations={organizations} />
          ) : activeView === "workItems" ? (
            <WorkItemSearch organizations={organizations} />
          ) : activeView === "myWorkItems" ? (
            <MyWorkItemsPanel organizations={organizations} />
          ) : activeView === "commits" ? (
            <CommitSearch organizations={organizations} />
          ) : organizations.length === 0 ? (
            <SetupPanel />
          ) : (
            <OrganizationSettings organizations={organizations} />
          )}
        </section>
      </main>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function CommitSearch({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [branch, setBranch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: searchCommits,
  });

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const repositoriesQuery = useQuery({
    queryKey: ["commitRepositories", selectedOrganizationId],
    queryFn: () => listCommitRepositories({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
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

  useEffect(() => {
    if (
      repositoryId &&
      !filteredRepositoryOptions.some((repository) => repository.repositoryId === repositoryId)
    ) {
      setRepositoryId("");
    }
  }, [filteredRepositoryOptions, repositoryId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.reset();
    if (fromDate && toDate && fromDate > toDate) {
      setValidationError("From date must be before or equal to To date.");
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

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-white">
        <form className="grid gap-4 p-5" onSubmit={onSubmit}>
          <div className="grid gap-4 xl:grid-cols-[minmax(240px,1fr)_180px_180px_170px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="message, author, repository, SHA"
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
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
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
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !selectedOrganizationId}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[150px_150px_auto_220px_240px_1fr]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">To</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
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
                    className="inline-flex h-10 items-center rounded-md border border-input bg-background px-2.5 text-xs hover:bg-muted"
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
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
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

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      <CommitResults loading={mutation.isPending} results={results} searched={mutation.isSuccess} />
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

const CommitGridRow = forwardRef<
  HTMLDivElement,
  {
    commit: CommitSummary;
    selected: boolean;
    columnTemplate: string;
    onSelect: () => void;
  }
>(({ commit, selected, columnTemplate, onSelect }, ref) => {
  const message = commit.comment.split(/\r?\n/, 1)[0] || "(no comment)";
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter" && commit.webUrl) {
          e.stopPropagation();
          openExternalUrl(commit.webUrl);
        }
      }}
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (commit.webUrl) openExternalUrl(commit.webUrl); }}
        className="truncate text-left font-mono text-xs text-primary hover:underline"
        title={commit.commitId}
      >
        {commit.shortCommitId}
      </button>
      <span
        className="text-xs text-muted-foreground"
        title={commit.authorDate ? formatDate(commit.authorDate) : undefined}
      >
        {commit.authorDate ? formatRelativeDate(commit.authorDate) : "—"}
      </span>
      <span className="truncate font-medium text-foreground" title={commit.comment}>
        {message}
      </span>
      <span className="truncate text-xs text-muted-foreground" title={`${commit.projectName} / ${commit.repositoryName}`}>
        {commit.projectName} / {commit.repositoryName}
      </span>
      <span className="truncate text-xs text-muted-foreground" title={commit.authorName ?? undefined}>
        {commit.authorName ?? "—"}
      </span>
    </div>
  );
});
CommitGridRow.displayName = "CommitGridRow";

function CommitResults({
  loading,
  results,
  searched,
}: {
  loading: boolean;
  results: CommitSummary[];
  searched: boolean;
}) {
  const [sort, setCommitSort] = useState<CommitSortState>({ key: "date", direction: "desc" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(COMMIT_COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_COMMIT_COLUMN_WIDTHS, COMMIT_COLUMN_MIN_WIDTHS, COMMIT_COLUMN_MAX_WIDTHS),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    localStorage.setItem(COMMIT_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const commitColTemplate = columnWidths.map((w) => `${w}px`).join(" ");

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

  function moveSelection(delta: number) {
    setSelectedIndex((prev) => {
      const next = clamp(prev + delta, 0, sorted.length - 1);
      rowRefs.current[next]?.focus();
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Home") { e.preventDefault(); setSelectedIndex(0); rowRefs.current[0]?.focus(); }
    else if (e.key === "End") {
      e.preventDefault();
      const last = sorted.length - 1;
      setSelectedIndex(last);
      rowRefs.current[last]?.focus();
    }
    else if (e.key === "PageDown") { e.preventDefault(); moveSelection(10); }
    else if (e.key === "PageUp") { e.preventDefault(); moveSelection(-10); }
    else if (e.key === "Enter") {
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

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="text-sm text-muted-foreground">{countLabel}</span>
      </div>
      {!searched && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Run a search to load commits.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No commits matched.
        </div>
      ) : (
        <div role="grid" aria-label="Commit search results" className="overflow-x-auto" onKeyDown={handleKeyDown}>
          <div className="min-w-[720px]">
            <div
              role="row"
              className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ gridTemplateColumns: commitColTemplate }}
            >
              <div role="columnheader" className="relative min-w-0 truncate px-1">
                SHA
                <ColumnResizeHandle columnIndex={0} widths={columnWidths} setWidths={setColumnWidths} min={COMMIT_COLUMN_MIN_WIDTHS[0]} max={COMMIT_COLUMN_MAX_WIDTHS[0]} />
              </div>
              {COMMIT_GRID_KEYS.map((col, i) => (
                <CommitSortHeaderButton
                  key={col}
                  column={col}
                  sort={sort}
                  onSort={applySort}
                  resizeHandle={
                    i < COMMIT_GRID_KEYS.length - 1 ? (
                      <ColumnResizeHandle
                        columnIndex={i + 1}
                        widths={columnWidths}
                        setWidths={setColumnWidths}
                        min={COMMIT_COLUMN_MIN_WIDTHS[i + 1]}
                        max={COMMIT_COLUMN_MAX_WIDTHS[i + 1]}
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>
            {loading ? (
              <div className="flex min-h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : (
              sorted.map((commit, index) => (
                <CommitGridRow
                  key={`${commit.repositoryId}:${commit.commitId}`}
                  ref={(el) => { rowRefs.current[index] = el; }}
                  commit={commit}
                  selected={index === selectedIndex}
                  columnTemplate={commitColTemplate}
                  onSelect={() => setSelectedIndex(index)}
                />
              ))
            )}
          </div>
        </div>
      )}
      {copyToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
          {copyToast}
        </div>
      )}
    </div>
  );
}

function WorkItemSearch({ organizations }: { organizations: Organization[] }) {
  const organizationId = organizations[0]?.id ?? "";
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [workItemType, setWorkItemType] = useState("");
  const [projectId, setProjectId] = useState("");

  const repositoriesQuery = useQuery({
    queryKey: ["wiRepositories", organizationId],
    queryFn: () => listCommitRepositories({ organizationId }),
    enabled: !!organizationId,
  });
  const allRepositories = repositoriesQuery.data ?? [];
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const repo of allRepositories) seen.set(repo.projectId, repo.projectName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [allRepositories]);

  const mutation = useMutation({ mutationFn: searchWorkItems });
  const results = mutation.data ?? [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId,
      query,
      state,
      workItemType,
      projectId: projectId || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-white">
        <form className="grid gap-4 p-5" onSubmit={onSubmit}>
          <div className="grid gap-4 lg:grid-cols-[1fr_160px_150px_160px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="title, type, assignee…"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={repositoriesQuery.isLoading}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">State</span>
              <select
                value={state}
                onChange={(event) => setState(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All</option>
                <option value="New">New</option>
                <option value="Active">Active</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Type</span>
              <select
                value={workItemType}
                onChange={(event) => setWorkItemType(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Any</option>
                <option value="Bug">Bug</option>
                <option value="Epic">Epic</option>
                <option value="Feature">Feature</option>
                <option value="Task">Task</option>
                <option value="User Story">User Story</option>
                <option value="Test Case">Test Case</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !organizationId}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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
        </form>
      </div>

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      <WorkItemsGrid loading={mutation.isPending} results={results} searched={mutation.isSuccess} />
    </div>
  );
}

type WiSortKey =
  | "id"
  | "workItemType"
  | "state"
  | "title"
  | "projectName"
  | "assignedTo"
  | "changedDate";
type WiSortState = { key: WiSortKey; direction: SortDirection };

const wiSortLabels: Record<WiSortKey, string> = {
  id: "#",
  workItemType: "Type",
  state: "State",
  title: "Title",
  projectName: "Project",
  assignedTo: "Assigned To",
  changedDate: "Changed",
};

function compareWorkItems(a: WorkItemSummary, b: WorkItemSummary, key: WiSortKey): number {
  switch (key) {
    case "id":
      return a.id - b.id;
    case "workItemType":
      return (a.workItemType ?? "￿").localeCompare(b.workItemType ?? "￿");
    case "state":
      return (a.state ?? "￿").localeCompare(b.state ?? "￿");
    case "title":
      return a.title.localeCompare(b.title);
    case "projectName":
      return a.projectName.localeCompare(b.projectName);
    case "assignedTo":
      return (a.assignedTo ?? "￿").localeCompare(b.assignedTo ?? "￿");
    case "changedDate":
      return (a.changedDate ?? "").localeCompare(b.changedDate ?? "");
  }
}

function WiSortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
}: {
  column: WiSortKey;
  sort: WiSortState;
  onSort: (column: WiSortKey) => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort.key === column;
  const label = wiSortLabels[column];
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

const WI_GRID_KEYS: WiSortKey[] = [
  "id",
  "workItemType",
  "state",
  "title",
  "projectName",
  "assignedTo",
  "changedDate",
];

const WorkItemGridRow = forwardRef<
  HTMLDivElement,
  {
    item: WorkItemSummary;
    selected: boolean;
    columnTemplate: string;
    onSelect: () => void;
  }
>(({ item, selected, columnTemplate, onSelect }, ref) => (
  <div
    ref={ref}
    tabIndex={selected ? 0 : -1}
    role="row"
    aria-selected={selected}
    onClick={onSelect}
    onKeyDown={(e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      if (e.key === "Enter" && item.webUrl) {
        e.stopPropagation();
        openExternalUrl(item.webUrl);
      }
    }}
    className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
      selected ? "bg-secondary" : "hover:bg-muted/50"
    }`}
    style={{ gridTemplateColumns: columnTemplate }}
  >
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (item.webUrl) openExternalUrl(item.webUrl);
      }}
      className="truncate text-left font-mono text-xs text-primary hover:underline"
      title={`#${item.id}`}
    >
      #{item.id}
    </button>
    <span className="truncate text-xs text-muted-foreground" title={item.workItemType ?? undefined}>
      {item.workItemType ?? "—"}
    </span>
    <span className="truncate text-xs" title={item.state ?? undefined}>
      {item.state ?? "—"}
    </span>
    <span className="truncate font-medium text-foreground" title={item.title}>
      {item.title}
    </span>
    <span className="truncate text-xs text-muted-foreground" title={item.projectName}>
      {item.projectName}
    </span>
    <span
      className="truncate text-xs text-muted-foreground"
      title={item.assignedTo ?? "Unassigned"}
    >
      {item.assignedTo ?? "—"}
    </span>
    <span
      className="text-xs text-muted-foreground"
      title={item.changedDate ? new Date(item.changedDate).toLocaleString() : undefined}
    >
      {item.changedDate ? formatRelativeDate(item.changedDate) : "—"}
    </span>
  </div>
));
WorkItemGridRow.displayName = "WorkItemGridRow";

function WorkItemsGrid({
  results,
  loading,
  searched,
  autoFocus = false,
  emptyMessage,
}: {
  results: WorkItemSummary[];
  loading: boolean;
  searched: boolean;
  autoFocus?: boolean;
  emptyMessage?: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sort, setWiSort] = useState<WiSortState>({ key: "changedDate", direction: "desc" });
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(WI_COLUMN_WIDTHS_STORAGE_KEY, DEFAULT_WI_COLUMN_WIDTHS, WI_COLUMN_MIN_WIDTHS, WI_COLUMN_MAX_WIDTHS),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    localStorage.setItem(WI_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const sorted = useMemo(
    () =>
      results
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const result = compareWorkItems(a.item, b.item, sort.key);
          const directed = sort.direction === "asc" ? result : -result;
          return directed || a.index - b.index;
        })
        .map(({ item }) => item),
    [results, sort],
  );

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(sorted.length - 1, 0)));
  }, [sorted.length]);

  function moveSelection(index: number) {
    const next = Math.max(0, Math.min(index, sorted.length - 1));
    setSelectedIndex(next);
    rowRefs.current[next]?.focus();
  }

  function applyWiSort(column: WiSortKey) {
    setWiSort((current) => {
      if (current.key !== column) {
        return { key: column, direction: column === "changedDate" ? "desc" : "asc" };
      }
      return { key: column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
    setSelectedIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    if (sorted.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveSelection(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveSelection(sorted.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 10);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = sorted[selectedIndex];
      if (item?.webUrl) openExternalUrl(item.webUrl);
    } else if (e.key === "c" || e.key === "C") {
      const item = sorted[selectedIndex];
      if (item?.webUrl) {
        void navigator.clipboard.writeText(item.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    }
  }

  const wiColTemplate = columnWidths.map((w) => `${w}px`).join(" ");

  return (
    <div ref={containerRef} className="outline-none" tabIndex={-1} onKeyDown={handleKeyDown}>
      {copyToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
          {copyToast}
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-border bg-white">
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div
              role="row"
              className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ gridTemplateColumns: wiColTemplate }}
            >
              {WI_GRID_KEYS.map((col, i) => (
                <WiSortHeaderButton
                  key={col}
                  column={col}
                  sort={sort}
                  onSort={applyWiSort}
                  resizeHandle={
                    i < WI_GRID_KEYS.length - 1 ? (
                      <ColumnResizeHandle
                        columnIndex={i}
                        widths={columnWidths}
                        setWidths={setColumnWidths}
                        min={WI_COLUMN_MIN_WIDTHS[i]}
                        max={WI_COLUMN_MAX_WIDTHS[i]}
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>

            {loading ? (
              <LoadingState />
            ) : !searched ? (
              <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                {emptyMessage ?? "Run a search to load work items."}
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                No work items matched.
              </div>
            ) : (
              <div role="grid" aria-label="Work items">
                {sorted.map((item, i) => (
                  <WorkItemGridRow
                    key={`${item.organizationId}:${item.projectId}:${item.id}`}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    item={item}
                    selected={i === selectedIndex}
                    columnTemplate={wiColTemplate}
                    onSelect={() => setSelectedIndex(i)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center border-t border-border px-2 py-1 text-xs text-muted-foreground">
          <span>
            {loading
              ? "Loading…"
              : searched
                ? `${sorted.length} item${sorted.length === 1 ? "" : "s"}`
                : "Ready"}
          </span>
        </div>
      </div>
    </div>
  );
}

function MyWorkItemsPanel({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [filter, setFilter] = useState("");

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  const query = useQuery({
    queryKey: ["myWorkItems", selectedOrganizationId],
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
  });

  const allResults = query.data ?? [];
  const results = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return allResults;
    return allResults.filter((item) => item.title.toLowerCase().includes(term));
  }, [allResults, filter]);

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-white">
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_180px_auto]">
          <label className="grid gap-2">
            <span className="text-sm font-medium">Filter</span>
            <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by title"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          </label>

          {organizations.length > 1 ? (
            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={selectedOrganizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="flex items-end">
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => query.refetch()}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              {query.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              Refresh
            </button>
          </div>
        </div>
      </div>

      {query.isError ? (
        <ErrorState message={commandErrorMessage(query.error)} />
      ) : null}

      <WorkItemsGrid
        loading={query.isFetching}
        results={results}
        searched={query.isSuccess || query.isFetching}
        autoFocus
      />
    </div>
  );
}

function formatRelativeDate(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

type VoteValue = -10 | -5 | 0 | 5 | 10 | number;

function VoteBadge({ vote, label }: { vote: VoteValue; label: string }) {
  const colors: Record<number, string> = {
    10: "bg-green-100 text-green-800 border-green-200",
    5: "bg-teal-100 text-teal-800 border-teal-200",
    0: "bg-gray-100 text-gray-600 border-gray-200",
    [-5]: "bg-yellow-100 text-yellow-800 border-yellow-200",
    [-10]: "bg-red-100 text-red-800 border-red-200",
  };
  const cls = colors[vote] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return required ? (
    <span className="inline-flex items-center rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
      Required
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
      Optional
    </span>
  );
}

const ReviewPrRow = forwardRef<
  HTMLDivElement,
  {
    pr: ReviewPullRequestSummary;
    selected: boolean;
    columnTemplate: string;
    onSelect: () => void;
  }
>(({ pr, selected, columnTemplate, onSelect }, ref) => {
  const isStale = Math.floor((Date.now() - new Date(pr.creationDate).getTime()) / 86_400_000) >= 3;
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        if (e.key === "Enter" && pr.webUrl) {
          e.stopPropagation();
          openExternalUrl(pr.webUrl);
        }
      }}
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1.5 text-sm outline-none
        focus:ring-2 focus:ring-inset focus:ring-ring
        ${selected && isStale ? "bg-orange-100 dark:bg-orange-900/30"
          : selected ? "bg-secondary"
          : isStale ? "bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100/70"
          : "hover:bg-muted/50"}`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      {/* PR# */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (pr.webUrl) openExternalUrl(pr.webUrl);
        }}
        className="truncate text-left font-mono text-xs text-primary hover:underline"
        title={`PR #${pr.pullRequestId}`}
      >
        #{pr.pullRequestId}
      </button>

      {/* Repository */}
      <span className="truncate text-sm text-foreground" title={pr.repositoryName}>
        {pr.repositoryName}
      </span>

      {/* Title + Draft badge */}
      <div className="flex min-w-0 items-center gap-1.5">
        {pr.isDraft && (
          <span className="inline-flex shrink-0 items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500">
            Draft
          </span>
        )}
        <span className="truncate font-medium text-foreground" title={pr.title}>
          {pr.title}
        </span>
      </div>

      {/* Author */}
      <span className="truncate text-sm text-muted-foreground" title={pr.createdBy ?? "Unknown"}>
        {pr.createdBy ?? "Unknown"}
      </span>

      {/* Created */}
      <span
        className={`text-xs ${isStale ? "font-medium text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
        title={new Date(pr.creationDate).toLocaleString()}
      >
        {formatRelativeDate(pr.creationDate)}
      </span>

      {/* Target branch */}
      <span className="truncate text-xs text-muted-foreground" title={pr.targetRefName}>
        {pr.targetRefName}
      </span>

      {/* Required / Optional */}
      <RequiredBadge required={pr.myIsRequired} />

      {/* Vote */}
      <VoteBadge vote={pr.myVote} label={pr.myVoteLabel} />
    </div>
  );
});
ReviewPrRow.displayName = "ReviewPrRow";

type VoteFilter = "noVote" | "approved" | "waitingAuthor" | "all";
type SortKey =
  | "pullRequestId"
  | "repositoryName"
  | "title"
  | "createdBy"
  | "creationDate"
  | "targetRefName"
  | "myIsRequired"
  | "myVote";
type SortDirection = "asc" | "desc";
type SortState = {
  key: SortKey;
  direction: SortDirection;
};

const sortLabels: Record<SortKey, string> = {
  pullRequestId: "PR#",
  repositoryName: "Repository",
  title: "Title",
  createdBy: "Author",
  creationDate: "Created",
  targetRefName: "Target",
  myIsRequired: "Role",
  myVote: "My Vote",
};

function defaultSortDirection(key: SortKey): SortDirection {
  return key === "creationDate" ? "desc" : "asc";
}

function compareStrings(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

function compareReviewPrs(
  a: ReviewPullRequestSummary,
  b: ReviewPullRequestSummary,
  key: SortKey,
): number {
  switch (key) {
    case "pullRequestId":
      return a.pullRequestId - b.pullRequestId;
    case "repositoryName":
      return compareStrings(a.repositoryName, b.repositoryName);
    case "title":
      return compareStrings(a.title, b.title);
    case "createdBy":
      return compareStrings(a.createdBy, b.createdBy);
    case "creationDate":
      return new Date(a.creationDate).getTime() - new Date(b.creationDate).getTime();
    case "targetRefName":
      return compareStrings(a.targetRefName, b.targetRefName);
    case "myIsRequired":
      return Number(a.myIsRequired) - Number(b.myIsRequired);
    case "myVote":
      return a.myVote - b.myVote;
  }
}

function ColumnResizeHandle({
  columnIndex,
  widths,
  setWidths,
  min,
  max,
}: {
  columnIndex: number;
  widths: number[];
  setWidths: React.Dispatch<React.SetStateAction<number[]>>;
  min: number;
  max: number;
}) {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/20 active:bg-primary/40"
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = widths[columnIndex];
        function onMove(ev: PointerEvent) {
          setWidths((prev) => {
            const next = [...prev];
            next[columnIndex] = clamp(startWidth + (ev.clientX - startX), min, max);
            return next;
          });
        }
        function onUp() {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
    />
  );
}

function SortHeaderButton({
  column,
  sort,
  onSort,
  resizeHandle,
}: {
  column: SortKey;
  sort: SortState;
  onSort: (column: SortKey) => void;
  resizeHandle?: ReactNode;
}) {
  const active = sort.key === column;
  const label = sortLabels[column];

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

function MyReviewsGrid({ organizations }: { organizations: Organization[] }) {
  const organizationId = organizations[0]?.id ?? "";

  const query = useQuery({
    queryKey: ["myReviews", organizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId }),
    enabled: !!organizationId,
  });

  const [textFilter, setTextFilter] = useState("");
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("noVote");
  const [showDrafts, setShowDrafts] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sort, setSort] = useState<SortState>({ key: "creationDate", direction: "desc" });
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(
      PR_GRID_COLUMN_WIDTHS_STORAGE_KEY,
      DEFAULT_PR_GRID_COLUMN_WIDTHS,
      PR_GRID_COLUMN_MIN_WIDTHS,
      PR_GRID_COLUMN_MAX_WIDTHS,
    ),
  );
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_REVIEW_PREVIEW_WIDTH,
      280,
      820,
    ),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    localStorage.setItem(PR_GRID_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const allPrs = query.data ?? [];

  const filtered = useMemo(() => {
    const lower = textFilter.toLowerCase();
    return allPrs.filter((pr) => {
      if (!showDrafts && pr.isDraft) return false;
      if (
        lower &&
        !pr.repositoryName.toLowerCase().includes(lower) &&
        !pr.title.toLowerCase().includes(lower) &&
        !(pr.createdBy ?? "").toLowerCase().includes(lower)
      )
        return false;
      if (voteFilter === "noVote" && pr.myVote !== 0) return false;
      if (voteFilter === "approved" && pr.myVote !== 10 && pr.myVote !== 5) return false;
      if (voteFilter === "waitingAuthor" && pr.myVote !== -5) return false;
      return true;
    });
  }, [allPrs, textFilter, voteFilter, showDrafts]);

  const sortedPrs = useMemo(() => {
    return filtered
      .map((pr, index) => ({ pr, index }))
      .sort((a, b) => {
        const result = compareReviewPrs(a.pr, b.pr, sort.key);
        const directed = sort.direction === "asc" ? result : -result;
        return directed || a.index - b.index;
      })
      .map(({ pr }) => pr);
  }, [filtered, sort]);

  const visiblePrs = allPrs.filter((pr) => showDrafts || !pr.isDraft);
  const noVoteCount = visiblePrs.filter((pr) => pr.myVote === 0).length;
  const isFiltered = !!textFilter || voteFilter !== "all";
  const selectedPr = sortedPrs[selectedIndex] ?? null;

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
  });

  const previewQuery = useQuery({
    queryKey: ["reviewResultPreview", selectedPr?.pullRequestId],
    queryFn: () => getReviewResultPreview({ pullRequestId: selectedPr?.pullRequestId ?? 0 }),
    enabled: !!selectedPr,
  });

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      REVIEW_PREVIEW_WIDTH_STORAGE_KEY,
      String(Math.round(previewWidth)),
    );
  }, [previewWidth]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(sortedPrs.length - 1, 0)));
  }, [sortedPrs.length]);

  function applyVoteFilter(value: VoteFilter) {
    setVoteFilter(value);
    setSelectedIndex(0);
  }

  function focusRow(index: number) {
    rowRefs.current[index]?.focus();
  }

  function moveSelection(index: number) {
    const next = Math.max(0, Math.min(index, sortedPrs.length - 1));
    setSelectedIndex(next);
    focusRow(next);
  }

  function moveVoteFilter(delta: number) {
    const currentIndex = voteFilterOptions.findIndex((option) => option.value === voteFilter);
    const nextIndex = (currentIndex + delta + voteFilterOptions.length) % voteFilterOptions.length;
    applyVoteFilter(voteFilterOptions[nextIndex].value);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const editable = isEditableTarget(e.target);
    const targetElement = e.target instanceof HTMLElement ? e.target : null;
    const buttonTarget = targetElement?.closest("button");

    if (editable) {
      if (e.key === "Escape") {
        e.preventDefault();
        setTextFilter("");
        setSelectedIndex(0);
        (e.target as HTMLElement).blur();
      } else if (e.key === "ArrowDown" && filtered.length > 0) {
        e.preventDefault();
        moveSelection(selectedIndex);
      }
      return;
    }

    if (buttonTarget?.closest('[role="tablist"]') && e.key === "ArrowRight") {
      e.preventDefault();
      moveVoteFilter(1);
      return;
    }
    if (buttonTarget?.closest('[role="tablist"]') && e.key === "ArrowLeft") {
      e.preventDefault();
      moveVoteFilter(-1);
      return;
    }
    if (buttonTarget && (e.key === "Enter" || e.key === " ")) {
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
      return;
    }
    if (e.key === "1") {
      e.preventDefault();
      applyVoteFilter("noVote");
      return;
    }
    if (e.key === "2") {
      e.preventDefault();
      applyVoteFilter("approved");
      return;
    }
    if (e.key === "3") {
      e.preventDefault();
      applyVoteFilter("waitingAuthor");
      return;
    }
    if (e.key === "4") {
      e.preventDefault();
      applyVoteFilter("all");
      return;
    }
    if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      setShowDrafts((value) => !value);
      setSelectedIndex(0);
      return;
    }
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      void query.refetch();
      return;
    }
    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      const pr = sortedPrs[selectedIndex];
      if (pr?.webUrl) {
        void navigator.clipboard.writeText(pr.webUrl).then(
          () => { setCopyToast("URL copied"); setTimeout(() => setCopyToast(null), 1500); },
          () => { setCopyToast("Copy failed"); setTimeout(() => setCopyToast(null), 1500); },
        );
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setTextFilter("");
      setVoteFilter("noVote");
      setSelectedIndex(0);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveVoteFilter(1);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveVoteFilter(-1);
      return;
    }
    if (sortedPrs.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveSelection(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveSelection(sortedPrs.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 10);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pr = sortedPrs[selectedIndex];
      if (pr?.webUrl) openExternalUrl(pr.webUrl);
    }
  }

  function applySort(column: SortKey) {
    setSort((current) => {
      if (current.key !== column) {
        return { key: column, direction: defaultSortDirection(column) };
      }
      return { key: column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
    setSelectedIndex(0);
  }

  const voteFilterOptions: { value: VoteFilter; label: string }[] = [
    { value: "noVote", label: "No Vote" },
    { value: "approved", label: "Approved" },
    { value: "waitingAuthor", label: "Waiting Author" },
    { value: "all", label: "All" },
  ];

  const COLS = columnWidths.map((width) => `${width}px`).join(" ");

  return (
    <div
      ref={containerRef}
      className="space-y-2 outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {copyToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg"
        >
          {copyToast}
        </div>
      )}
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        {/* Text search */}
        <div className="flex h-8 flex-1 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={filterInputRef}
            type="text"
            placeholder="Filter by repo, title, author…"
            value={textFilter}
            onChange={(e) => {
              setTextFilter(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {textFilter && (
            <button
              type="button"
              onClick={() => setTextFilter("")}
              className="ml-1 rounded text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Vote filter tabs */}
        <div
          className="flex items-center gap-0.5 rounded-md border border-border bg-gray-50 p-0.5"
          role="tablist"
          aria-label="Vote filter"
        >
          {voteFilterOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                applyVoteFilter(opt.value);
              }}
              role="tab"
              aria-selected={voteFilter === opt.value}
              aria-pressed={voteFilter === opt.value}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                voteFilter === opt.value
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Draft checkbox */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDrafts}
            onChange={(e) => {
              setShowDrafts(e.target.checked);
              setSelectedIndex(0);
            }}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Show Drafts
        </label>

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div
        className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(280px,var(--review-preview-width))]"
        style={{ "--review-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        {/* Grid */}
        <div className="min-w-0 overflow-hidden rounded-md border border-border bg-white">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              {/* Column headers */}
              <div
                role="row"
                className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: COLS }}
              >
                {(["pullRequestId", "repositoryName", "title", "createdBy", "creationDate", "targetRefName", "myIsRequired"] as SortKey[]).map((col, i) => (
                  <SortHeaderButton
                    key={col}
                    column={col}
                    sort={sort}
                    onSort={applySort}
                    resizeHandle={
                      <ColumnResizeHandle
                        columnIndex={i}
                        widths={columnWidths}
                        setWidths={setColumnWidths}
                        min={PR_GRID_COLUMN_MIN_WIDTHS[i]}
                        max={PR_GRID_COLUMN_MAX_WIDTHS[i]}
                      />
                    }
                  />
                ))}
                <SortHeaderButton column="myVote" sort={sort} onSort={applySort} />
              </div>

              {query.isLoading ? (
                <LoadingState />
              ) : query.isError ? (
                <ErrorState message={commandErrorMessage(query.error)} />
              ) : sortedPrs.length === 0 ? (
                <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                  {allPrs.length === 0 ? "No pull requests assigned to you." : "No results match the current filter."}
                </div>
              ) : (
                <div role="grid" aria-label="My review pull requests">
                  {sortedPrs.map((pr, i) => (
                    <ReviewPrRow
                      key={`${pr.organizationId}-${pr.pullRequestId}`}
                      ref={(el) => { rowRefs.current[i] = el; }}
                      columnTemplate={COLS}
                      pr={pr}
                      selected={i === selectedIndex}
                      onSelect={() => setSelectedIndex(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
            <span>
              {visiblePrs.length} 件中{" "}
              <span className="font-medium text-foreground">{noVoteCount}</span> 件が未投票
            </span>
            {isFiltered && <span>フィルタ適用中: {sortedPrs.length} 件表示</span>}
          </div>
        </div>

        <ResizeHandle
          ariaLabel="Resize review preview"
          className="hidden xl:flex"
          direction={-1}
          max={820}
          min={280}
          onChange={setPreviewWidth}
          onReset={() => setPreviewWidth(DEFAULT_REVIEW_PREVIEW_WIDTH)}
          value={previewWidth}
        />

        <ReviewResultPreviewPanel
          selectedPr={selectedPr}
          settings={settingsQuery.data ?? null}
          settingsLoading={settingsQuery.isLoading}
          preview={previewQuery.data ?? null}
          previewLoading={previewQuery.isFetching}
          previewError={previewQuery.isError ? commandErrorMessage(previewQuery.error) : null}
        />
      </div>
    </div>
  );
}

function ReviewResultPreviewPanel({
  selectedPr,
  settings,
  settingsLoading,
  preview,
  previewLoading,
  previewError,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  settings: AppSettings | null;
  settingsLoading: boolean;
  preview: ReviewResultPreview | null;
  previewLoading: boolean;
  previewError: string | null;
}) {
  const hasFolder = !!settings?.reviewResultFolderPath;

  return (
    <aside className="flex min-h-[520px] flex-col overflow-hidden rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Review Preview</h2>
            <p className="truncate text-xs text-muted-foreground">
              {selectedPr ? `PR${selectedPr.pullRequestId}` : "No PR selected"}
            </p>
          </div>
        </div>
        {previewLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>

      {settingsLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading
        </div>
      ) : !selectedPr ? (
        <PreviewEmptyState message="Select a pull request." />
      ) : !hasFolder ? (
        <PreviewEmptyState message="Review result folder is not configured." />
      ) : previewError ? (
        <div className="m-3 rounded-md border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">
          {previewError}
        </div>
      ) : preview ? (
        <>
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-xs font-medium" title={preview.fileName}>
              {preview.fileName}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={preview.filePath}>
              {preview.filePath}
            </p>
          </div>
          <iframe
            title={`Review result preview for PR${preview.pullRequestId}`}
            sandbox=""
            srcDoc={preview.html}
            className="min-h-0 flex-1 bg-white"
          />
        </>
      ) : (
        <PreviewEmptyState message={`No HTML file matched PR${selectedPr.pullRequestId}.`} />
      )}
    </aside>
  );
}

function PreviewEmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function ResizeHandle({
  ariaLabel,
  className,
  direction,
  max,
  min,
  onChange,
  onReset,
  value,
}: {
  ariaLabel: string;
  className?: string;
  direction: 1 | -1;
  max: number;
  min: number;
  onChange: (value: number) => void;
  onReset: () => void;
  value: number;
}) {
  function nudge(delta: number) {
    onChange(clamp(value + delta * direction, min, max));
  }

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) =>
        beginHorizontalResize(event, { value, min, max, direction, onChange })
      }
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudge(-16);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          nudge(16);
        } else if (event.key === "Home") {
          event.preventDefault();
          onChange(direction === 1 ? min : max);
        } else if (event.key === "End") {
          event.preventDefault();
          onChange(direction === 1 ? max : min);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onReset();
        }
      }}
      className={`z-20 w-2 cursor-col-resize items-center justify-center text-muted-foreground outline-none hover:bg-secondary focus:bg-secondary focus:ring-2 focus:ring-ring ${className ?? ""}`}
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </div>
  );
}


function HelpDialog({ onClose }: { onClose: () => void }) {
  const section = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-4 first:mt-0";
  const row = "flex items-center justify-between gap-8 py-0.5";
  const kbd = "rounded bg-muted px-1.5 py-0.5 text-xs font-mono";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="relative w-full max-w-sm rounded-lg border border-border bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="help-title" className="flex items-center gap-2 text-base font-semibold">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Keyboard Shortcuts
          </h2>
          <button
            aria-label="Close keyboard shortcuts"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="text-sm">
          <p className={section}>Navigation</p>
          <div className={row}><span>My Reviews</span><kbd className={kbd}>Alt+1</kbd></div>
          <div className={row}><span>PR Search</span><kbd className={kbd}>Alt+2</kbd></div>
          <div className={row}><span>My Work Items</span><kbd className={kbd}>Alt+3</kbd></div>
          <div className={row}><span>WI Search</span><kbd className={kbd}>Alt+4</kbd></div>
          <div className={row}><span>Commits</span><kbd className={kbd}>Alt+5</kbd></div>
          <div className={row}><span>Settings</span><kbd className={kbd}>Alt+6</kbd></div>

          <p className={section}>My Reviews</p>
          <div className={row}><span>Focus search</span><kbd className={kbd}>/</kbd></div>
          <div className={row}><span>Filter: All / My / Approved / Rejected</span><kbd className={kbd}>1–4</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>Enter</kbd></div>
          <div className={row}><span>Toggle details</span><kbd className={kbd}>D</kbd></div>
          <div className={row}><span>Mark reviewed</span><kbd className={kbd}>R</kbd></div>
          <div className={row}><span>Copy URL</span><kbd className={kbd}>C</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>↑ ↓</kbd></div>

          <p className={section}>PR Search / WI Search / Commits</p>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>Enter</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>↑ ↓ Home End</kbd></div>
          <div className={row}><span>Copy URL</span><kbd className={kbd}>C</kbd></div>

          <p className={section}>General</p>
          <div className={row}><span>Show this help</span><kbd className={kbd}>?</kbd></div>
          <div className={row}><span>Close dialog</span><kbd className={kbd}>Esc</kbd></div>
        </div>
      </div>
    </div>
  );
}

function NavButton({
  active,
  disabled = false,
  icon,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-keyshortcuts={shortcut}
      className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium ${
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {icon}
      {label}
    </button>
  );
}

function NavSection({
  icon,
  label,
  disabled = false,
  children,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex h-10 items-center gap-3 px-3 text-sm font-semibold text-foreground">
        {icon}
        {label}
      </div>
      <div className="ml-3 space-y-0.5 border-l border-border pl-4">
        {children}
      </div>
    </div>
  );
}

function NavSubItem({
  active,
  disabled = false,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-keyshortcuts={shortcut}
      className={`flex h-8 w-full items-center rounded-md px-2 text-left text-sm ${
        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {label}
    </button>
  );
}


function LoadingState() {
  return (
    <div className="flex min-h-64 items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
      Loading
    </div>
  );
}

type ErrorKind = "auth" | "rateLimit" | "network" | "default";

function classifyError(message: string): ErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes("authentication failed") || lower.includes("secret storage") || lower.includes("status 401") || lower.includes("status 403")) {
    return "auth";
  }
  if (lower.includes("rate limited") || lower.includes("status 429")) {
    return "rateLimit";
  }
  if (lower.includes("network error") || lower.includes("connection") || lower.includes("timed out") || lower.includes("dns")) {
    return "network";
  }
  return "default";
}

function ErrorState({ message }: { message: string }) {
  const kind = classifyError(message);

  const variants: Record<ErrorKind, { containerCls: string; textCls: string; icon: ReactNode; hint: string }> = {
    auth: {
      containerCls: "border-amber-200 bg-amber-50",
      textCls: "text-amber-800",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />,
      hint: "Check your Personal Access Token in Settings — it may have expired.",
    },
    rateLimit: {
      containerCls: "border-yellow-200 bg-yellow-50",
      textCls: "text-yellow-800",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" aria-hidden="true" />,
      hint: "Azure DevOps rate limit reached. Wait a moment, then try again.",
    },
    network: {
      containerCls: "border-gray-200 bg-gray-50",
      textCls: "text-gray-700",
      icon: <WifiOff className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />,
      hint: "Check your internet connection and try again.",
    },
    default: {
      containerCls: "border-destructive/30 bg-red-50",
      textCls: "text-destructive",
      icon: <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />,
      hint: "",
    },
  };

  const { containerCls, textCls, icon, hint } = variants[kind];

  return (
    <div role="alert" className={`flex gap-3 rounded-md border p-4 ${containerCls}`}>
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className={`text-sm font-medium ${textCls}`}>{message}</p>
        {hint && <p className={`mt-1 text-xs ${textCls} opacity-80`}>{hint}</p>}
      </div>
    </div>
  );
}

function PullRequestSearch({
  organizations,
}: {
  organizations: Organization[];
}) {
  const organizationId = organizations[0]?.id ?? "";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchPullRequestsInput["status"]>("active");
  const [projectId, setProjectId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");

  const repositoriesQuery = useQuery({
    queryKey: ["prRepositories", organizationId],
    queryFn: () => listCommitRepositories({ organizationId }),
    enabled: !!organizationId,
  });
  const allRepositories = repositoriesQuery.data ?? [];

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const repo of allRepositories) seen.set(repo.projectId, repo.projectName);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [allRepositories]);

  const filteredRepositories = useMemo(
    () => (projectId ? allRepositories.filter((r) => r.projectId === projectId) : allRepositories),
    [allRepositories, projectId],
  );

  function onProjectChange(newProjectId: string) {
    setProjectId(newProjectId);
    setRepositoryId("");
  }

  const mutation = useMutation({ mutationFn: searchPullRequests });
  const results = mutation.data ?? [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId,
      query,
      status,
      projectId: projectId || undefined,
      repositoryId: repositoryId || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-white">
        <form className="grid gap-4 p-5" onSubmit={onSubmit}>
          <div className="grid gap-4 lg:grid-cols-[1fr_160px_200px_160px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="title, author, branch…"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <select
                value={projectId}
                onChange={(e) => onProjectChange(e.target.value)}
                disabled={repositoriesQuery.isLoading}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <select
                value={repositoryId}
                onChange={(e) => setRepositoryId(e.target.value)}
                disabled={repositoriesQuery.isLoading}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">All repositories</option>
                {filteredRepositories.map((r) => (
                  <option key={r.repositoryId} value={r.repositoryId}>{r.repositoryName}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SearchPullRequestsInput["status"])}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="abandoned">Abandoned</option>
                <option value="all">All</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !organizationId}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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
        </form>
      </div>

      {mutation.isError && <ErrorState message={commandErrorMessage(mutation.error)} />}

      <PullRequestResults loading={mutation.isPending} results={results} searched={mutation.isSuccess} />
    </div>
  );
}

const PR_SEARCH_HEADER_LABELS = ["PR#", "Status", "Title", "Repository", "Author", "Date", "Branch"];

function PullRequestResults({
  loading,
  results,
  searched,
}: {
  loading: boolean;
  results: PullRequestSummary[];
  searched: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [columnWidths, setColumnWidths] = useState(() =>
    storedNumbers(
      PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY,
      DEFAULT_PR_SEARCH_COLUMN_WIDTHS,
      PR_SEARCH_COLUMN_MIN_WIDTHS,
      PR_SEARCH_COLUMN_MAX_WIDTHS,
    ),
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    localStorage.setItem(PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const columnTemplate = columnWidths.map((w) => `${w}px`).join(" ");

  const countLabel = useMemo(() => {
    if (loading) return "Searching";
    if (!searched) return "Ready";
    return `${results.length} pull request${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length, searched]);

  function moveSelection(delta: number) {
    setSelectedIndex((prev) => {
      const next = clamp(prev + delta, 0, results.length - 1);
      rowRefs.current[next]?.focus();
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isEditableTarget(e.target)) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "c" || e.key === "C") {
      const pr = results[selectedIndex];
      if (pr?.webUrl) {
        void navigator.clipboard.writeText(pr.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="text-sm text-muted-foreground">{countLabel}</span>
      </div>
      {!searched && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Run a search to load pull requests.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No pull requests matched.
        </div>
      ) : (
        <div role="grid" aria-label="Pull request search results" className="overflow-x-auto" onKeyDown={handleKeyDown}>
          <div
            role="row"
            className="grid border-b border-border bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground"
            style={{ gridTemplateColumns: columnTemplate }}
          >
            {PR_SEARCH_HEADER_LABELS.map((label, i) => (
              <div key={label} role="columnheader" className="relative min-w-0 truncate px-1">
                {label}
                {i < PR_SEARCH_HEADER_LABELS.length - 1 && (
                  <ColumnResizeHandle
                    columnIndex={i}
                    widths={columnWidths}
                    setWidths={setColumnWidths}
                    min={PR_SEARCH_COLUMN_MIN_WIDTHS[i]}
                    max={PR_SEARCH_COLUMN_MAX_WIDTHS[i]}
                  />
                )}
              </div>
            ))}
          </div>
          {loading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            results.map((pr, index) => (
              <PrSearchRow
                key={`${pr.repositoryId}:${pr.pullRequestId}`}
                ref={(el) => { rowRefs.current[index] = el; }}
                pr={pr}
                selected={index === selectedIndex}
                columnTemplate={columnTemplate}
                onSelect={() => setSelectedIndex(index)}
              />
            ))
          )}
        </div>
      )}
      {copyToast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
          {copyToast}
        </div>
      )}
    </div>
  );
}

const PR_STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  abandoned: "bg-gray-50 text-gray-500 border-gray-200",
};

const PrSearchRow = forwardRef<
  HTMLDivElement,
  {
    pr: PullRequestSummary;
    selected: boolean;
    columnTemplate: string;
    onSelect: () => void;
  }
>(({ pr, selected, columnTemplate, onSelect }, ref) => {
  const statusColor = PR_STATUS_COLORS[pr.status] ?? "bg-secondary text-foreground border-border";
  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (e.key === "Enter" && pr.webUrl) {
          e.stopPropagation();
          openExternalUrl(pr.webUrl);
        }
      }}
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
      style={{ gridTemplateColumns: columnTemplate }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (pr.webUrl) openExternalUrl(pr.webUrl); }}
        className="truncate text-left font-mono text-xs text-primary hover:underline"
        title={`PR #${pr.pullRequestId}`}
      >
        #{pr.pullRequestId}
      </button>
      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium capitalize ${statusColor}`}>
        {pr.status}
      </span>
      <span className="truncate font-medium text-foreground" title={pr.title}>
        {pr.title}
      </span>
      <span className="truncate text-xs text-muted-foreground" title={`${pr.projectName} / ${pr.repositoryName}`}>
        {pr.projectName} / {pr.repositoryName}
      </span>
      <span className="truncate text-sm text-muted-foreground" title={pr.createdBy ?? "Unknown"}>
        {pr.createdBy ?? "Unknown"}
      </span>
      <span className="text-xs text-muted-foreground" title={formatDate(pr.creationDate)}>
        {formatRelativeDate(pr.creationDate)}
      </span>
      <span className="truncate text-xs text-muted-foreground" title={`${pr.sourceRefName} → ${pr.targetRefName}`}>
        {pr.sourceRefName} → {pr.targetRefName}
      </span>
    </div>
  );
});
PrSearchRow.displayName = "PrSearchRow";


function OrganizationSettings({
  organizations,
}: {
  organizations: Organization[];
}) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: deleteOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });

  function onDelete(org: Organization) {
    if (!window.confirm(`Remove "${org.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate({ id: org.id });
  }

  return (
    <div className="space-y-6">
      <SetupPanel compact />
      <ReviewResultFolderSettings />
      <div className="overflow-hidden rounded-md border border-border bg-white">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Organizations</h2>
        </div>
        {deleteMutation.isError && (
          <p className="px-5 py-2 text-sm text-destructive">
            {commandErrorMessage(deleteMutation.error)}
          </p>
        )}
        <div className="divide-y divide-border">
          {organizations.map((organization) => (
            <div
              key={organization.id}
              className="grid items-center gap-4 px-5 py-4 md:grid-cols-[1fr_auto_auto_auto]"
            >
              <div>
                <p className="font-medium">{organization.name}</p>
                <p className="text-sm text-muted-foreground">
                  {organization.baseUrl}
                </p>
              </div>
              <div className="text-left text-sm md:text-right">
                <p className="text-muted-foreground">Auth</p>
                <p className="font-medium">
                  {formatAuthProvider(organization.authProvider)}
                </p>
              </div>
              <div className="text-left text-sm md:text-right">
                <p className="text-muted-foreground">Authenticated user</p>
                <p className="font-medium">
                  {organization.authenticatedUserDisplayName ?? "Unknown"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(organization)}
                disabled={deleteMutation.isPending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                aria-label={`Remove ${organization.name}`}
                title={`Remove ${organization.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewResultFolderSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
  });
  const [folderPath, setFolderPath] = useState("");

  useEffect(() => {
    setFolderPath(settingsQuery.data?.reviewResultFolderPath ?? "");
  }, [settingsQuery.data?.reviewResultFolderPath]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
      void queryClient.invalidateQueries({ queryKey: ["reviewResultPreview"] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({ reviewResultFolderPath: folderPath });
  }

  return (
    <div className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Review result previews</h2>
            <p className="text-sm text-muted-foreground">
              Local HTML files matched by PR number.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-4 p-5" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Folder path</span>
          <input
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            placeholder="C:\\reports\\azdo-reviews"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700">Review result folder saved.</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function SetupPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [organization, setOrganization] = useState("");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function onOrganizationConnected() {
    setOrganization("");
    setPat("");
    setValidationError(null);
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
  }

  const patMutation = useMutation({
    mutationFn: addPatOrganization,
    onSuccess: onOrganizationConnected,
  });

  const azureCliMutation = useMutation({
    mutationFn: addAzureCliOrganization,
    onSuccess: onOrganizationConnected,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    patMutation.reset();
    azureCliMutation.reset();
    if (!organization.trim() || !pat.trim()) {
      setValidationError("Organization and PAT are required.");
      return;
    }
    setValidationError(null);
    patMutation.mutate({ organization, pat });
  }

  function onConnectAzureCli() {
    patMutation.reset();
    azureCliMutation.reset();
    if (!organization.trim()) {
      setValidationError("Organization is required.");
      return;
    }
    setValidationError(null);
    azureCliMutation.mutate({ organization });
  }

  const isConnecting = patMutation.isPending || azureCliMutation.isPending;

  return (
    <div className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {compact ? "Add organization" : "Connect Azure DevOps"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Credentials are validated before they are saved.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-5 p-5" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Organization</span>
          <input
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            placeholder="contoso"
            autoFocus={!compact}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Personal access token</span>
          <div className="flex h-10 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <input
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              type={showPat ? "text" : "password"}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPat((value) => !value)}
              className="flex w-10 items-center justify-center border-l border-border text-muted-foreground hover:bg-secondary"
              aria-label={showPat ? "Hide PAT" : "Show PAT"}
            >
              {showPat ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </label>

        {validationError ? (
          <p role="alert" className="text-sm text-destructive">
            {validationError}
          </p>
        ) : null}

        {patMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(patMutation.error)}
          </p>
        ) : null}

        {azureCliMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(azureCliMutation.error)}
          </p>
        ) : null}

        {patMutation.isSuccess || azureCliMutation.isSuccess ? (
          <p className="text-sm text-green-700">Organization connected.</p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isConnecting}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {patMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Connect
          </button>
          <button
            type="button"
            disabled={isConnecting}
            onClick={onConnectAzureCli}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {azureCliMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Building2 className="h-4 w-4" aria-hidden="true" />
            )}
            Connect with Azure CLI
          </button>
        </div>
      </form>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAuthProvider(value: string): string {
  return value === "azure_cli" ? "Azure CLI" : value.toUpperCase();
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
    </Routes>
  );
}

export default App;
