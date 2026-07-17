import { useRef, useState } from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';
import type { BulkWorkItemResult, WorkItemAssigneeCandidate } from '@/lib/azdoCommands';

/**
 * Counts non-empty values and returns them ordered by frequency (ties broken
 * by label) so the bulk bar can show the most common type/state first.
 */
export function summarizeBy(values: (string | null | undefined)[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value?.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Renders up to `max` breakdown chips, folding the rest into a `+N` chip. */
function BulkBreakdown({
  entries,
  max = 3,
}: {
  entries: { label: string; count: number }[];
  max?: number;
}) {
  if (entries.length === 0) return null;
  const shown = entries.slice(0, max);
  const hidden = entries.slice(max);
  const hiddenCount = hidden.reduce((sum, e) => sum + e.count, 0);
  const hiddenTitle = hidden.map((e) => `${e.count} ${e.label}`).join(", ");
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((entry) => (
        <span
          key={entry.label}
          className="inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
        >
          {entry.count} {entry.label}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span
          title={hiddenTitle}
          className="inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          +{hiddenCount}
        </span>
      ) : null}
    </span>
  );
}

export function BulkFailurePanel({
  failures,
  onDismiss,
}: {
  failures: BulkWorkItemResult[];
  onDismiss: () => void;
}) {
  return (
    <div className="mb-2 rounded-md border border-destructive/30 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-destructive">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {failures.length} bulk update failure{failures.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1 text-destructive hover:bg-red-100 dark:hover:bg-red-950"
        >
          Dismiss
        </button>
      </div>
      <ul className="mt-1 max-h-24 overflow-auto">
        {failures.map((failure) => (
          <li key={failure.id} className="truncate">
            #{failure.id}: {failure.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BulkActionBar({
  count,
  typeBreakdown,
  stateBreakdown,
  onClear,
  stateOpen,
  onStateOpenChange,
  stateOptions,
  stateLoading,
  statePending,
  onStateSelect,
  assignOpen,
  onAssignOpenChange,
  assignQuery,
  onAssignQueryChange,
  assignOptions,
  assignLoading,
  assignPending,
  onAssignSelect,
  priorityOpen,
  onPriorityOpenChange,
  priorityPending,
  onPrioritySelect,
  tagsPending,
  onTagsApply,
  snoozePending,
  onSnoozeOpen,
}: {
  count: number;
  typeBreakdown: { label: string; count: number }[];
  stateBreakdown: { label: string; count: number }[];
  onClear: () => void;
  stateOpen: boolean;
  onStateOpenChange: (open: boolean) => void;
  stateOptions: string[];
  stateLoading: boolean;
  statePending: boolean;
  onStateSelect: (state: string) => void;
  assignOpen: boolean;
  onAssignOpenChange: (open: boolean) => void;
  assignQuery: string;
  onAssignQueryChange: (q: string) => void;
  assignOptions: WorkItemAssigneeCandidate[];
  assignLoading: boolean;
  assignPending: boolean;
  onAssignSelect: (candidate: WorkItemAssigneeCandidate) => void;
  priorityOpen: boolean;
  onPriorityOpenChange: (open: boolean) => void;
  priorityPending: boolean;
  onPrioritySelect: (priority: number) => void;
  tagsPending: boolean;
  onTagsApply: (tag: string, mode: "add" | "remove") => void;
  snoozePending: boolean;
  onSnoozeOpen: (anchorRect: DOMRect) => void;
}) {
  const stateListRef = useRef<HTMLDivElement>(null);
  const priorityListRef = useRef<HTMLDivElement>(null);
  const assignInputRef = useRef<HTMLInputElement>(null);
  const assignListRef = useRef<HTMLDivElement>(null);
  const [tagDraft, setTagDraft] = useState("");

  function applyTag(mode: "add" | "remove") {
    const tag = tagDraft.trim();
    if (!tag) return;
    onTagsApply(tag, mode);
    setTagDraft("");
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5">
      <span className="text-xs font-medium text-foreground">
        {count} item{count === 1 ? "" : "s"} selected
      </span>
      {typeBreakdown.length > 0 ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <BulkBreakdown entries={typeBreakdown} />
        </span>
      ) : null}
      {stateBreakdown.length > 0 ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="text-muted-foreground/60" aria-hidden="true">·</span>
          <BulkBreakdown entries={stateBreakdown} />
        </span>
      ) : null}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={snoozePending}
          onClick={(event) => onSnoozeOpen(event.currentTarget.getBoundingClientRect())}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
        >
          {snoozePending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
          Snooze
        </button>
        {/* State picker */}
        <div className="relative">
          <button
            type="button"
            disabled={statePending}
            onClick={() => onStateOpenChange(!stateOpen)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            {statePending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            State
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
          {stateOpen ? (
            <div ref={stateListRef} className="absolute left-0 top-full z-30 mt-1 min-w-[130px] rounded-md border border-border bg-popover py-1 shadow-lg">
              {stateLoading ? (
                <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading…
                </div>
              ) : (
                stateOptions.map((s, index) => (
                  <button
                    key={s}
                    type="button"
                    autoFocus={index === 0}
                    onClick={() => { onStateSelect(s); onStateOpenChange(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") onStateOpenChange(false);
                      else if (e.key === "Enter") { e.stopPropagation(); }
                      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const buttons = Array.from(stateListRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                        const i = buttons.indexOf(e.currentTarget);
                        if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                        else if (i > 0) buttons[i - 1].focus();
                      }
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {s}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        {/* Assignee picker */}
        <div className="relative">
          <button
            type="button"
            disabled={assignPending}
            onClick={() => onAssignOpenChange(!assignOpen)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            {assignPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Assignee
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
          {assignOpen ? (
            <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg">
              <input
                ref={assignInputRef}
                autoFocus
                value={assignQuery}
                onChange={(e) => onAssignQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onAssignOpenChange(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    assignListRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
                  }
                }}
                placeholder="Search assignee..."
                className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />
              <div ref={assignListRef} className="max-h-44 overflow-auto">
                {assignLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</div>
                ) : assignOptions.length > 0 ? (
                  assignOptions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onAssignSelect(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") onAssignOpenChange(false);
                        else if (e.key === "Enter") { e.stopPropagation(); }
                        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const buttons = Array.from(assignListRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                          const i = buttons.indexOf(e.currentTarget);
                          if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                          else if (i > 0) buttons[i - 1].focus();
                          else assignInputRef.current?.focus();
                        }
                      }}
                      className="flex w-full min-w-0 flex-col rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                    >
                      <span className="truncate font-medium">{c.displayName}</span>
                      {c.uniqueName ? (
                        <span className="truncate text-[11px] text-muted-foreground">{c.uniqueName}</span>
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {assignQuery.trim() ? "No matches" : "No recent assignees"}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div className="relative">
          <button
            type="button"
            disabled={priorityPending}
            onClick={() => onPriorityOpenChange(!priorityOpen)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            {priorityPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Priority
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
          {priorityOpen ? (
            <div ref={priorityListRef} className="absolute left-0 top-full z-30 mt-1 min-w-[96px] rounded-md border border-border bg-popover py-1 shadow-lg">
              {[1, 2, 3, 4].map((priority, index) => (
                <button
                  key={priority}
                  type="button"
                  autoFocus={index === 0}
                  onClick={() => {
                    onPrioritySelect(priority);
                    onPriorityOpenChange(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") onPriorityOpenChange(false);
                    else if (e.key === "Enter") { e.stopPropagation(); }
                    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const buttons = Array.from(priorityListRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                      const i = buttons.indexOf(e.currentTarget);
                      if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                      else if (i > 0) buttons[i - 1].focus();
                    }
                  }}
                  className="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {priority}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {/* Tags add/remove across the selection */}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyTag("add");
              }
            }}
            disabled={tagsPending}
            placeholder="Tag…"
            aria-label="Tag to add or remove"
            className="h-7 w-24 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="button"
            disabled={tagsPending || !tagDraft.trim()}
            onClick={() => applyTag("add")}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            {tagsPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Add tag
          </button>
          <button
            type="button"
            disabled={tagsPending || !tagDraft.trim()}
            onClick={() => applyTag("remove")}
            className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-xs font-medium hover:bg-secondary disabled:opacity-60"
          >
            Remove
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Clear selection"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
