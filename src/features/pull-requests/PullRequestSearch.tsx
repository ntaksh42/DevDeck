import {
  type FormEvent,
  forwardRef,
  useEffect,
  useRef,
  useMemo,
  useState,
} from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import {
  searchPullRequests,
  listCommitRepositories,
  commandErrorMessage,
  type Organization,
  type SearchPullRequestsInput,
  type PullRequestSummary,
} from '@/lib/azdoCommands';
import { clamp, storedNumbers, isEditableTarget, formatDate, formatRelativeDate } from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { ColumnResizeHandle } from '@/components/ResizeHandle';
import { ShortcutHint } from '@/components/ShortcutHint';
import { ErrorState } from '@/components/StateDisplay';

const DEFAULT_PR_SEARCH_COLUMN_WIDTHS = [64, 80, 300, 160, 128, 72, 160];
const PR_SEARCH_COLUMN_MIN_WIDTHS = [56, 70, 200, 120, 100, 64, 120];
const PR_SEARCH_COLUMN_MAX_WIDTHS = [120, 140, 720, 360, 280, 120, 360];
const PR_SEARCH_COLUMN_WIDTHS_STORAGE_KEY = 'azdodeck:layout:prSearchGridColumnWidths';
export function PullRequestSearch({
  organizations,
}: {
  organizations: Organization[];
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchPullRequestsInput["status"]>("active");
  const [projectId, setProjectId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");

  const repositoriesQuery = useQuery({
    queryKey: ["prRepositories", organizationId],
    queryFn: () => listCommitRepositories({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
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
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-white">
        <form className="grid gap-3 p-3" onSubmit={onSubmit}>
          {organizations.length > 1 && (
            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={organizationId}
                onChange={(e) => { setOrganizationId(e.target.value); setProjectId(""); setRepositoryId(""); }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="grid gap-3 lg:grid-cols-[1fr_160px_200px_160px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
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
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
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
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
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
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
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
    if (results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
    else if (e.key === "Home") { e.preventDefault(); setSelectedIndex(0); rowRefs.current[0]?.focus(); }
    else if (e.key === "End") {
      e.preventDefault();
      const last = results.length - 1;
      setSelectedIndex(last);
      rowRefs.current[last]?.focus();
    }
    else if (e.key === "PageDown") { e.preventDefault(); moveSelection(10); }
    else if (e.key === "PageUp") { e.preventDefault(); moveSelection(-10); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const pr = results[selectedIndex];
      if (pr?.webUrl) openExternalUrl(pr.webUrl);
    }
    else if (e.key === "c" || e.key === "C") {
      e.preventDefault();
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
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {countLabel}
          <ShortcutHint>Alt+G</ShortcutHint>
        </span>
      </div>
      {!searched && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Run a search to load pull requests.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          No pull requests matched.
        </div>
      ) : (
        <div
          role="grid"
          aria-label="Pull request search results"
          data-primary-grid="true"
          tabIndex={-1}
          className="overflow-x-auto"
          onKeyDown={handleKeyDown}
        >
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
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
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
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
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

