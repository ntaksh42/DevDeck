import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, FileText, Loader2, RefreshCw, Search, X } from 'lucide-react';
import {
  listMyReviewPullRequests,
  getReviewResultPreview,
  getAppSettings,
  commandErrorMessage,
  type AppSettings,
  type Organization,
  type ReviewPullRequestSummary,
  type ReviewResultPreview,
} from '@/lib/azdoCommands';
import {

  matchesAllSearchTerms,
  splitSearchTerms,
  storedNumbers,
  storedNumber,
  isEditableTarget,

  formatRelativeDate,
  type SortDirection,
} from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { ShortcutHint } from '@/components/ShortcutHint';
import { ColumnResizeHandle, ResizeHandle } from '@/components/ResizeHandle';
import { LoadingState, ErrorState, PreviewEmptyState } from '@/components/StateDisplay';

const DEFAULT_REVIEW_PREVIEW_WIDTH = 420;
const REVIEW_PREVIEW_WIDTH_STORAGE_KEY = 'azdodeck:layout:reviewPreviewWidth';
const DEFAULT_PR_GRID_COLUMN_WIDTHS = [60, 190, 320, 104, 60, 104, 76, 104];
const PR_GRID_COLUMN_MIN_WIDTHS = [56, 160, 220, 96, 56, 96, 72, 96];
const PR_GRID_COLUMN_MAX_WIDTHS = [120, 520, 960, 240, 120, 240, 180, 240];
const PR_GRID_COLUMN_WIDTHS_STORAGE_KEY = 'azdodeck:layout:myReviewsGridColumnWidths';
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
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none
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

export function MyReviewsGrid({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");

  const query = useQuery({
    queryKey: ["myReviews", organizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
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
    const terms = splitSearchTerms(textFilter);
    return allPrs.filter((pr) => {
      if (!showDrafts && pr.isDraft) return false;
      if (!matchesAllSearchTerms(terms, [
        pr.pullRequestId,
        pr.repositoryName,
        pr.title,
        pr.createdBy,
        pr.targetRefName,
        pr.myVoteLabel,
      ]))
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
    staleTime: 5 * 60_000,
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
      className="flex min-h-0 flex-1 flex-col gap-2 outline-none"
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        {organizations.length > 1 && (
          <select
            value={organizationId}
            onChange={(e) => { setOrganizationId(e.target.value); setSelectedIndex(0); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            aria-label="Organization"
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
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
        className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(280px,var(--review-preview-width))]"
        style={{ "--review-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        {/* Grid */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-white">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[980px]">
              {/* Column headers */}
              <div
                role="row"
                className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
                <div
                  role="grid"
                  aria-label="My review pull requests"
                  data-primary-grid="true"
                  tabIndex={-1}
                >
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
              {visiblePrs.length} total,{" "}
              <span className="font-medium text-foreground">{noVoteCount}</span> not voted
            </span>
            <span className="flex items-center gap-2">
              {isFiltered ? <span>Filtered: {sortedPrs.length} shown</span> : null}
              <ShortcutHint>Alt+G</ShortcutHint>
            </span>
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
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-white">
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
        ) : (
          <ShortcutHint>Alt+P</ShortcutHint>
        )}
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
            aria-keyshortcuts="Alt+P"
            sandbox=""
            srcDoc={preview.html}
            className="min-h-0 flex-1 bg-white outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
            data-primary-preview="true"
            tabIndex={-1}
          />
        </>
      ) : (
        <PreviewEmptyState message={`No HTML file matched PR${selectedPr.pullRequestId}.`} />
      )}
    </aside>
  );
}
