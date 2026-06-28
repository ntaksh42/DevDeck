import { useEffect, useRef } from "react";
import type { WorkItemAssigneeCandidate } from "@/lib/azdoCommands";
import {
  useCloseOnOutsidePointer,
  CandidateAvatar,
  HighlightedText,
} from "./PreviewEditorsBase";

export function AssigneePicker({
  current,
  error,
  mutationError,
  loading,
  onOpenChange,
  onQueryChange,
  onSelect,
  open,
  options,
  pending,
  query,
  shortcut,
}: {
  current: string | null;
  error: string | null;
  mutationError?: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (candidate: WorkItemAssigneeCandidate) => void;
  open: boolean;
  options: WorkItemAssigneeCandidate[];
  pending: boolean;
  query: string;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Change assignee"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "Unassigned"}
      >
        {pending ? "Updating..." : current ?? "Unassigned"}
      </button>
      {mutationError && (
        <p className="mt-0.5 text-[10px] text-destructive">{mutationError}</p>
      )}
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg">
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
              }
            }}
            placeholder="Search assignee..."
            className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div ref={listRef} className="max-h-44 overflow-auto">
            {error ? (
              <div className="mb-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                Search failed: {error}
              </div>
            ) : null}
            {loading ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching...</div>
            ) : options.length > 0 ? (
              options.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onSelect(candidate)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                    else if (e.key === "Enter") { e.stopPropagation(); }
                    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                      const i = buttons.indexOf(e.currentTarget);
                      if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                      else if (i > 0) buttons[i - 1].focus();
                      else inputRef.current?.focus();
                    }
                  }}
                  className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                >
                  <CandidateAvatar displayName={candidate.displayName} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      <HighlightedText text={candidate.displayName} query={query} />
                    </span>
                    {candidate.uniqueName ? (
                      <span className="truncate text-[11px] text-muted-foreground">
                        <HighlightedText text={candidate.uniqueName} query={query} />
                      </span>
                    ) : null}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {query.trim() ? "No matches" : "No recent assignees"}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
