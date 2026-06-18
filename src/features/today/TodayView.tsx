import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink } from "lucide-react";
import {
  commandErrorMessage,
  listMyReviewPullRequests,
  listMyWorkItems,
  prLocator,
  setWorkItemsState,
  submitPullRequestVote,
  type Organization,
  type ReviewPullRequestSummary,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { workItemQueryKeys } from "@/features/work-items/queryKeys";
import { VOTE_BADGE_CLASSES, voteTone } from "@/features/pull-requests/voteVisual";
import { formatDate, formatRelativeDate, isEditableTarget } from "@/lib/utils";
import { LoadingState, ErrorState } from "@/components/StateDisplay";

export const MAX_REVIEW_ROWS = 10;
export const MAX_WORK_ITEM_ROWS = 20;
// States that the Today view considers "active" / in-progress work.
const ACTIVE_WORK_ITEM_STATES = new Set(["active", "doing", "in progress", "committed"]);
const QUICK_STATES = ["Active", "Resolved", "Closed"];

type TodayRow =
  | { kind: "pr"; index: number; pr: ReviewPullRequestSummary }
  | { kind: "wi"; index: number; item: WorkItemSummary };

const VOTE_ACTIONS: { key: string; vote: -10 | -5 | 0 | 5 | 10; label: string }[] = [
  { key: "a", vote: 10, label: "Approve" },
  { key: "s", vote: 5, label: "Suggestions" },
  { key: "w", vote: -5, label: "Wait" },
  { key: "x", vote: -10, label: "Reject" },
  { key: "0", vote: 0, label: "No vote" },
];

function isActiveWorkItem(item: WorkItemSummary): boolean {
  return ACTIVE_WORK_ITEM_STATES.has((item.state ?? "").trim().toLowerCase());
}

function changedTime(item: WorkItemSummary): number {
  const time = item.changedDate ? new Date(item.changedDate).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

// Required pull requests the user has not voted on, oldest first, capped.
export function selectTodayReviews(
  prs: ReviewPullRequestSummary[],
): ReviewPullRequestSummary[] {
  return prs
    .filter((pr) => pr.myIsRequired && pr.myVote === 0 && !pr.isDraft)
    .sort((a, b) => {
      const left = new Date(a.creationDate).getTime();
      const right = new Date(b.creationDate).getTime();
      return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
    })
    .slice(0, MAX_REVIEW_ROWS);
}

// Active work items assigned to the user, most recently changed first, capped.
export function selectTodayWorkItems(items: WorkItemSummary[]): WorkItemSummary[] {
  return items
    .filter(isActiveWorkItem)
    .sort((a, b) => changedTime(b) - changedTime(a))
    .slice(0, MAX_WORK_ITEM_ROWS);
}

export function TodayView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  const reviewsQuery = useQuery({
    queryKey: ["myReviews", selectedOrganizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const workItemsQuery = useQuery({
    queryKey: workItemQueryKeys.myItems(selectedOrganizationId),
    queryFn: () => listMyWorkItems({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });

  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [statePickerId, setStatePickerId] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const statePickerRef = useRef<HTMLDivElement | null>(null);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 1500);
  }

  const voteMutation = useMutation({
    mutationFn: submitPullRequestVote,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["myReviews"] });
    },
  });
  const stateMutation = useMutation({
    mutationFn: setWorkItemsState,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItemsRoot() });
    },
  });

  const reviewRows = useMemo(
    () => selectTodayReviews(reviewsQuery.data ?? []),
    [reviewsQuery.data],
  );

  const workItemRows = useMemo(
    () => selectTodayWorkItems(workItemsQuery.data ?? []),
    [workItemsQuery.data],
  );

  // Flat row model: PR rows first, then work item rows. Keyboard navigation
  // walks this single list so the two sections feel like one focus surface.
  const rows = useMemo<TodayRow[]>(() => {
    const list: TodayRow[] = [];
    reviewRows.forEach((pr, i) => list.push({ kind: "pr", index: i, pr }));
    workItemRows.forEach((item, i) =>
      list.push({ kind: "wi", index: reviewRows.length + i, item }),
    );
    return list.map((row, index) => ({ ...row, index }));
  }, [reviewRows, workItemRows]);

  const isLoading = reviewsQuery.isLoading || workItemsQuery.isLoading;
  const isError = reviewsQuery.isError || workItemsQuery.isError;
  const errorMessage = reviewsQuery.isError
    ? commandErrorMessage(reviewsQuery.error)
    : workItemsQuery.isError
      ? commandErrorMessage(workItemsQuery.error)
      : "";
  const caughtUp = !isLoading && !isError && rows.length === 0;

  useEffect(() => {
    if (selectedIndex > rows.length - 1) setSelectedIndex(Math.max(0, rows.length - 1));
  }, [rows.length, selectedIndex]);

  useEffect(() => {
    if (!organizationId && organizations[0]) setOrganizationId(organizations[0].id);
  }, [organizationId, organizations]);

  // Close the state picker on outside click.
  useEffect(() => {
    if (statePickerId === null) return;
    function onMouseDown(event: MouseEvent) {
      if (!statePickerRef.current?.contains(event.target as Node)) {
        setStatePickerId(null);
        rowRefs.current[selectedIndex]?.focus();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [statePickerId, selectedIndex]);

  function focusRow(index: number) {
    rowRefs.current[index]?.focus();
  }

  function moveSelection(delta: number) {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, selectedIndex + delta));
    setSelectedIndex(next);
    window.setTimeout(() => focusRow(next), 0);
  }

  function openSelected() {
    const row = rows[selectedIndex];
    const url = row?.kind === "pr" ? row.pr.webUrl : row?.item.webUrl ?? null;
    if (url) void openExternalUrl(url);
  }

  function voteSelected(vote: -10 | -5 | 0 | 5 | 10, label: string) {
    const row = rows[selectedIndex];
    if (row?.kind !== "pr" || voteMutation.isPending) return;
    voteMutation.mutate(
      { ...prLocator(row.pr), vote },
      { onSuccess: () => showToast(`Voted: ${label}`) },
    );
  }

  function applyState(item: WorkItemSummary, state: string) {
    setStatePickerId(null);
    if (state === item.state) {
      focusRow(selectedIndex);
      return;
    }
    stateMutation.mutate(
      {
        organizationId: item.organizationId,
        projectId: item.projectId,
        workItemIds: [item.id],
        state,
      },
      {
        onSuccess: () => showToast(`State: ${state}`),
        onError: (error) => showToast(commandErrorMessage(error)),
      },
    );
    focusRow(selectedIndex);
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || statePickerId !== null) return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        openSelected();
      }
      return;
    }
    const row = rows[selectedIndex];
    switch (event.key) {
      case "ArrowDown":
      case "j":
      case "J":
        event.preventDefault();
        moveSelection(1);
        return;
      case "ArrowUp":
      case "k":
      case "K":
        event.preventDefault();
        moveSelection(-1);
        return;
      case "Home":
        event.preventDefault();
        setSelectedIndex(0);
        window.setTimeout(() => focusRow(0), 0);
        return;
      case "End":
        event.preventDefault();
        moveSelection(rows.length);
        return;
      case "o":
      case "O":
      case "Enter":
        event.preventDefault();
        openSelected();
        return;
    }
    if (row?.kind === "pr") {
      const action = VOTE_ACTIONS.find((candidate) => candidate.key === event.key.toLowerCase());
      if (action) {
        event.preventDefault();
        voteSelected(action.vote, action.label);
      }
      return;
    }
    if (row?.kind === "wi" && (event.key === "s" || event.key === "S")) {
      event.preventDefault();
      setStatePickerId(row.item.id);
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col gap-3 outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg"
        >
          {toast}
        </div>
      )}

      {organizations.length > 1 && (
        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor="today-org" className="text-xs text-muted-foreground">
            Organization
          </label>
          <select
            id="today-org"
            value={selectedOrganizationId}
            onChange={(event) => {
              setOrganizationId(event.target.value);
              setSelectedIndex(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={errorMessage} />
      ) : caughtUp ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" aria-hidden="true" />
          <p className="text-lg font-semibold text-foreground">All caught up today!</p>
          <p className="text-sm">No required reviews waiting and no active work items.</p>
        </div>
      ) : (
        <div
          role="grid"
          aria-label="Today focus"
          data-primary-grid="true"
          tabIndex={-1}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
        >
          <Section
            title="PR Reviews"
            subtitle="Required pull requests you have not voted on yet"
            count={reviewRows.length}
            emptyLabel="No required reviews waiting."
          >
            {reviewRows.map((pr, i) => (
              <PrRow
                key={`${pr.organizationId}-${pr.pullRequestId}`}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                pr={pr}
                selected={selectedIndex === i}
                onSelect={() => setSelectedIndex(i)}
              />
            ))}
          </Section>

          <Section
            title="My Work Items"
            subtitle="Active items assigned to you, most recently changed first"
            count={workItemRows.length}
            emptyLabel="No active work items."
          >
            {workItemRows.map((item, i) => {
              const flatIndex = reviewRows.length + i;
              return (
                <WorkItemRow
                  key={`${item.organizationId}-${item.id}`}
                  ref={(el) => {
                    rowRefs.current[flatIndex] = el;
                  }}
                  item={item}
                  selected={selectedIndex === flatIndex}
                  onSelect={() => setSelectedIndex(flatIndex)}
                  statePickerOpen={statePickerId === item.id}
                  statePickerRef={statePickerId === item.id ? statePickerRef : undefined}
                  onOpenStatePicker={() => {
                    setSelectedIndex(flatIndex);
                    setStatePickerId(item.id);
                  }}
                  onPickState={(state) => applyState(item, state)}
                  onCloseStatePicker={() => {
                    setStatePickerId(null);
                    focusRow(flatIndex);
                  }}
                />
              );
            })}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  emptyLabel,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {count === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div>{children}</div>
      )}
    </section>
  );
}

const PrRow = forwardRef<
  HTMLDivElement,
  {
    pr: ReviewPullRequestSummary;
    selected: boolean;
    onSelect: () => void;
  }
>(({ pr, selected, onSelect }, ref) => (
  <div
    ref={ref}
    role="row"
    aria-selected={selected}
    tabIndex={selected ? 0 : -1}
    onClick={onSelect}
    className={`grid cursor-pointer select-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-3 py-1 text-sm outline-none last:border-b-0 focus:ring-2 focus:ring-inset focus:ring-ring ${
      selected ? "bg-secondary" : "hover:bg-muted/50"
    }`}
  >
    <span className="font-mono text-xs text-primary">#{pr.pullRequestId}</span>
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium text-foreground" title={pr.title}>
        {pr.title}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{pr.repositoryName}</span>
    </span>
    <span className="flex shrink-0 items-center gap-2">
      <span
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${VOTE_BADGE_CLASSES[voteTone(pr.myVote)]}`}
      >
        {pr.myVoteLabel}
      </span>
      <span className="text-xs text-muted-foreground" title={formatDate(pr.creationDate)}>
        {formatRelativeDate(pr.creationDate)}
      </span>
      {pr.webUrl && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void openExternalUrl(pr.webUrl as string);
          }}
          aria-label="Open pull request in browser"
          className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  </div>
));
PrRow.displayName = "TodayPrRow";

const WorkItemRow = forwardRef<
  HTMLDivElement,
  {
    item: WorkItemSummary;
    selected: boolean;
    onSelect: () => void;
    statePickerOpen: boolean;
    statePickerRef?: RefObject<HTMLDivElement | null>;
    onOpenStatePicker: () => void;
    onPickState: (state: string) => void;
    onCloseStatePicker: () => void;
  }
>(
  (
    {
      item,
      selected,
      onSelect,
      statePickerOpen,
      statePickerRef,
      onOpenStatePicker,
      onPickState,
      onCloseStatePicker,
    },
    ref,
  ) => (
    <div
      ref={ref}
      role="row"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={`relative grid cursor-pointer select-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-3 py-1 text-sm outline-none last:border-b-0 focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
    >
      <span className="font-mono text-xs text-muted-foreground">#{item.id}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-foreground" title={item.title}>
          {item.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {item.workItemType ?? "Item"} · {item.projectName}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenStatePicker();
          }}
          className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground hover:bg-secondary"
          aria-haspopup="listbox"
          aria-expanded={statePickerOpen}
        >
          {item.state ?? "—"}
        </button>
        <span className="text-xs text-muted-foreground" title={item.changedDate ? formatDate(item.changedDate) : ""}>
          {item.changedDate ? formatRelativeDate(item.changedDate) : ""}
        </span>
        {item.webUrl && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void openExternalUrl(item.webUrl as string);
            }}
            aria-label="Open work item in browser"
            className="rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </span>
      {statePickerOpen && (
        <StatePicker
          ref={statePickerRef}
          current={item.state}
          onPick={onPickState}
          onClose={onCloseStatePicker}
        />
      )}
    </div>
  ),
);
WorkItemRow.displayName = "TodayWorkItemRow";

const StatePicker = forwardRef<
  HTMLDivElement,
  { current: string | null; onPick: (state: string) => void; onClose: () => void }
>(
  (
    {
      current,
      onPick,
      onClose,
    },
    ref,
  ) => {
    const options = QUICK_STATES;
    const [active, setActive] = useState(() => {
      const index = options.findIndex((option) => option === current);
      return index >= 0 ? index : 0;
    });
    const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
      optionRefs.current[active]?.focus();
    }, [active]);

    function onKeyDown(event: ReactKeyboardEvent) {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((value) => Math.min(options.length - 1, value + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((value) => Math.max(0, value - 1));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPick(options[active]);
      }
    }

    return (
      <div
        ref={ref}
        role="listbox"
        aria-label="Set work item state"
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        className="absolute right-2 top-full z-50 mt-1 w-36 rounded-md border border-border bg-popover p-1 shadow-lg"
      >
        {options.map((option, index) => (
          <button
            key={option}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            type="button"
            role="option"
            aria-selected={option === current}
            tabIndex={index === active ? 0 : -1}
            onClick={() => onPick(option)}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-secondary focus:bg-secondary focus:outline-none ${
              option === current ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            {option}
            {option === current && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
          </button>
        ))}
      </div>
    );
  },
);
StatePicker.displayName = "TodayStatePicker";
