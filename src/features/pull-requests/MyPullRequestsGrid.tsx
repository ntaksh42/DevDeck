import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Clock, Search, X, XCircle } from "lucide-react";
import {
  commandErrorMessage,
  listMyPullRequests,
  type MyPullRequestSummary,
  type Organization,
} from "@/lib/azdoCommands";
import { LoadingState, ErrorState } from "@/components/StateDisplay";
import {
  focusPrimaryGrid,
  formatDate,
  formatRelativeDate,
  isEditableTarget,
  matchesAllSearchTerms,
  splitSearchTerms,
} from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";

// Author-PR inbox sections, ordered by what needs my attention next: fix the
// changes requested, merge the approved ones, then those still waiting, then
// drafts.
type MyPrSection = "changesRequested" | "approved" | "awaiting" | "draft";

const SECTION_ORDER: MyPrSection[] = ["changesRequested", "approved", "awaiting", "draft"];

const SECTION_LABELS: Record<MyPrSection, string> = {
  changesRequested: "Changes requested",
  approved: "Approved",
  awaiting: "Awaiting review",
  draft: "Drafts",
};

export function sectionOf(pr: MyPullRequestSummary): MyPrSection {
  if (pr.isDraft) return "draft";
  if (pr.changesRequested) return "changesRequested";
  if (pr.approvals > 0) return "approved";
  return "awaiting";
}

function prKey(pr: MyPullRequestSummary): string {
  return `${pr.repositoryId}:${pr.pullRequestId}`;
}

type Row =
  | { kind: "header"; section: MyPrSection; count: number }
  | { kind: "pr"; pr: MyPullRequestSummary; index: number };

function VoteTally({ pr }: { pr: MyPullRequestSummary }) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-0.5 text-green-700 dark:text-green-400" title={`${pr.approvals} approved`}>
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        {pr.approvals}
      </span>
      <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title={`${pr.waiting} waiting for author`}>
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {pr.waiting}
      </span>
      <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400" title={`${pr.rejections} rejected`}>
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {pr.rejections}
      </span>
    </span>
  );
}

export function MyPullRequestsGrid({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const query = useQuery({
    queryKey: ["myPullRequests", selectedOrganizationId],
    queryFn: () => listMyPullRequests({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!organizationId && organizations[0]) setOrganizationId(organizations[0].id);
  }, [organizationId, organizations]);

  const allPrs = query.data ?? [];
  const filtered = useMemo(() => {
    const terms = splitSearchTerms(filter);
    return allPrs.filter((pr) =>
      matchesAllSearchTerms(terms, [pr.pullRequestId, pr.repositoryName, pr.title, pr.targetRefName]),
    );
  }, [allPrs, filter]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const delta = SECTION_ORDER.indexOf(sectionOf(a)) - SECTION_ORDER.indexOf(sectionOf(b));
        if (delta !== 0) return delta;
        return b.creationDate.localeCompare(a.creationDate);
      }),
    [filtered],
  );

  const { rows, prCount } = useMemo(() => {
    const counts = new Map<MyPrSection, number>();
    for (const pr of sorted) counts.set(sectionOf(pr), (counts.get(sectionOf(pr)) ?? 0) + 1);
    const out: Row[] = [];
    let current: MyPrSection | null = null;
    let index = 0;
    for (const pr of sorted) {
      const section = sectionOf(pr);
      if (section !== current) {
        current = section;
        out.push({ kind: "header", section, count: counts.get(section) ?? 0 });
      }
      out.push({ kind: "pr", pr, index });
      index += 1;
    }
    return { rows: out, prCount: index };
  }, [sorted]);

  useEffect(() => {
    if (selectedIndex >= prCount) setSelectedIndex(Math.max(0, prCount - 1));
  }, [prCount, selectedIndex]);

  const selectedPr = sorted[selectedIndex] ?? null;

  function focusRow(index: number) {
    window.setTimeout(() => rowRefs.current[index]?.focus(), 0);
  }

  function move(delta: number) {
    if (prCount === 0) return;
    const next = Math.max(0, Math.min(selectedIndex + delta, prCount - 1));
    setSelectedIndex(next);
    focusRow(next);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (isEditableTarget(event.target)) {
      if (event.key === "Escape") {
        event.preventDefault();
        setFilter("");
        (event.target as HTMLElement).blur();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && selectedPr?.webUrl) {
        event.preventDefault();
        openExternalUrl(selectedPr.webUrl);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
      case "j":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        move(-prCount);
        break;
      case "End":
        event.preventDefault();
        move(prCount);
        break;
      case "Enter":
        event.preventDefault();
        if (selectedPr?.webUrl) openExternalUrl(selectedPr.webUrl);
        break;
      case "/":
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
        break;
      case "c":
      case "C":
        if (selectedPr?.webUrl) void navigator.clipboard.writeText(selectedPr.webUrl);
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col gap-2 outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        {organizations.length > 1 && (
          <select
            value={selectedOrganizationId}
            onChange={(e) => {
              setOrganizationId(e.target.value);
              setSelectedIndex(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            aria-label="Organization"
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex h-8 flex-1 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={filterRef}
            type="text"
            placeholder="Filter by repo, title, branch…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter("")}
              className="ml-1 rounded text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card">
        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={commandErrorMessage(query.error)} />
        ) : sorted.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
            {allPrs.length === 0 ? "You have no active pull requests." : "No results match the filter."}
          </div>
        ) : (
          <div role="grid" aria-label="My pull requests" data-primary-grid="true" tabIndex={-1}>
            {rows.map((row) =>
              row.kind === "header" ? (
                <div
                  key={`header:${row.section}`}
                  role="row"
                  className="flex items-center gap-1 border-b border-border bg-muted/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {SECTION_LABELS[row.section]}
                  <span className="font-normal normal-case">({row.count})</span>
                </div>
              ) : (
                <div
                  key={prKey(row.pr)}
                  ref={(el) => {
                    rowRefs.current[row.index] = el;
                  }}
                  role="row"
                  tabIndex={row.index === selectedIndex ? 0 : -1}
                  aria-selected={row.index === selectedIndex}
                  onClick={() => setSelectedIndex(row.index)}
                  onDoubleClick={() => row.pr.webUrl && openExternalUrl(row.pr.webUrl)}
                  className={`grid cursor-pointer select-none grid-cols-[56px_140px_minmax(0,1fr)_120px_90px] items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
                    row.index === selectedIndex ? "bg-secondary" : "hover:bg-muted/50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (row.pr.webUrl) openExternalUrl(row.pr.webUrl);
                    }}
                    className="truncate text-left font-mono text-xs text-primary hover:underline"
                  >
                    #{row.pr.pullRequestId}
                  </button>
                  <span className="truncate text-sm text-foreground" title={row.pr.repositoryName}>
                    {row.pr.repositoryName}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {row.pr.isDraft && (
                      <span className="inline-flex shrink-0 items-center rounded border border-input bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        Draft
                      </span>
                    )}
                    <span className="truncate font-medium text-foreground" title={row.pr.title}>
                      {row.pr.title}
                    </span>
                    {row.pr.mergeStatus === "conflicts" ? (
                      <span
                        className="inline-flex shrink-0 items-center rounded border border-red-200 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                        title="This pull request has merge conflicts"
                      >
                        Conflicts
                      </span>
                    ) : null}
                  </span>
                  <Fragment>
                    <VoteTally pr={row.pr} />
                  </Fragment>
                  <span className="text-xs text-muted-foreground" title={formatDate(row.pr.creationDate)}>
                    {formatRelativeDate(row.pr.creationDate)}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
        <span>
          {prCount} pull request{prCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => focusPrimaryGrid()}
          className="rounded border border-border bg-card px-2 py-0.5 hover:bg-secondary"
        >
          Focus list
        </button>
      </div>
    </div>
  );
}
