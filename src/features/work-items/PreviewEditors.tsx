import { Fragment, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  ClassificationNodeOption,
  WorkItemAssigneeCandidate,
} from "@/lib/azdoCommands";
import { commentAuthorInitials } from "./workItemHtml";

/**
 * Controlled editing controls for the work item preview: the reason/state/
 * priority/assignee/custom-field pickers and their shared bits (outside-pointer
 * close hook, query highlighting, avatar). All are presentational — data and
 * mutations are passed in via props — so they live apart from the panel that
 * owns the state and queries.
 */

export function useCloseOnOutsidePointer<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) {
        return;
      }
      onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose, open]);

  return ref;
}

export function ReasonEditor({
  current,
  error,
  onOpenChange,
  onSubmit,
  open,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  open: boolean;
  pending: boolean;
  shortcut?: string;
}) {
  const [draft, setDraft] = useState(current ?? "");
  const editorRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );

  useEffect(() => {
    if (open) setDraft(current ?? "");
  }, [current, open]);

  function save() {
    const reason = draft.trim();
    if (!reason || reason === (current ?? "").trim() || pending) return;
    onSubmit(reason);
  }

  return (
    <div ref={editorRef} className="relative min-w-0">
      <button
        type="button"
        aria-label="Change reason"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (current ?? "—")}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
      )}
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            placeholder="Reason"
            className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim() || draft.trim() === (current ?? "").trim() || pending}
              onClick={save}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CustomFieldPicker({
  current,
  error,
  label,
  loading,
  onOpenChange,
  onSelect,
  open,
  options,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  label: string;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
  open: boolean;
  options: string[];
  pending: boolean;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const [customValue, setCustomValue] = useState("");
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    if (!open) setCustomValue("");
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div className="flex min-w-0 items-baseline gap-1.5 sm:col-span-2 2xl:col-span-3">
      <dt className="shrink-0 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </dt>
      <dd ref={pickerRef} className="relative min-w-0 flex-1">
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Change ${label}`}
          aria-keyshortcuts={shortcut}
          disabled={pending}
          onClick={() => onOpenChange(!open)}
          className="max-w-full truncate rounded px-1 text-left text-[12px] font-semibold leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
          title={current ?? "—"}
        >
          {pending ? "Updating..." : (current ?? "—")}
        </button>
        {error && <p className="mt-0.5 text-[10px] text-destructive">{error}</p>}
        {open ? (
          <div
            ref={listRef}
            className="absolute left-0 top-full z-30 mt-1 max-h-56 min-w-[160px] overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg"
          >
            {loading ? (
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Loading…
              </div>
            ) : (
              <>
                {options.length === 0 ? (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground">
                    No defined values
                  </div>
                ) : (
                  options.map((value, index) => (
                    <button
                      key={value}
                      type="button"
                      autoFocus={index === 0}
                      onClick={() => onSelect(value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                        else if (e.key === "Enter") { e.stopPropagation(); }
                        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                          const i = buttons.indexOf(e.currentTarget);
                          if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                          else if (i > 0) buttons[i - 1].focus();
                        }
                      }}
                      className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs ${
                        value === current
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${value === current ? "bg-primary" : "bg-transparent"}`}
                      />
                      <span className="truncate">{value}</span>
                    </button>
                  ))
                )}
                <form
                  className="flex items-center gap-1 border-t border-border px-2 py-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = customValue.trim();
                    if (value) onSelect(value);
                  }}
                >
                  <input
                    value={customValue}
                    onChange={(event) => setCustomValue(event.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                    }}
                    placeholder="Custom value"
                    aria-label={`Custom value for ${label}`}
                    className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={!customValue.trim()}
                    className="h-6 rounded border border-border bg-card px-2 text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Set
                  </button>
                </form>
              </>
            )}
          </div>
        ) : null}
      </dd>
    </div>
  );
}

export function StatePicker({
  current,
  error,
  loading,
  onOpenChange,
  onSelect,
  open,
  options,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (state: string) => void;
  open: boolean;
  options: string[];
  pending: boolean;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
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
        aria-label="Change state"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (current ?? "—")}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
      )}
      {open ? (
        <div ref={listRef} className="absolute left-0 top-full z-30 mt-1 min-w-[120px] rounded-md border border-border bg-popover py-1 shadow-lg">
          {loading ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No states available</div>
          ) : (
            options.map((state, index) => (
              <button
                key={state}
                type="button"
                autoFocus={index === 0}
                onClick={() => onSelect(state)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                  else if (e.key === "Enter") { e.stopPropagation(); }
                  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                    const i = buttons.indexOf(e.currentTarget);
                    if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                    else if (i > 0) buttons[i - 1].focus();
                  }
                }}
                className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs ${
                  state === current
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${state === current ? "bg-primary" : "bg-transparent"}`}
                />
                {state}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ClassificationPicker({
  ariaLabel,
  current,
  emptyLabel,
  error,
  loading,
  onOpenChange,
  onSelect,
  open,
  options,
  pending,
}: {
  ariaLabel: string;
  current: string | null;
  emptyLabel: string;
  error?: string | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  open: boolean;
  options: ClassificationNodeOption[];
  pending: boolean;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  // The current value is the full backslash path that always starts with the
  // project name. Drop that redundant root and join the rest with " › " so the
  // trigger shows the full classification path compactly; keep the complete
  // backslash path as the title for disambiguation.
  const segments = current?.split("\\").filter(Boolean) ?? [];
  const display = segments.length
    ? (segments.length > 1 ? segments.slice(1) : segments).join(" › ")
    : null;
  const selectedIndex = options.findIndex((option) => option.path === current);
  const autoFocusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (display ?? "—")}
      </button>
      {error && <p className="mt-0.5 text-[10px] text-destructive">{error}</p>}
      {open ? (
        <div
          ref={listRef}
          className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-[200px] overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {loading ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</div>
          ) : (
            options.map((option, index) => (
              <button
                key={option.path}
                type="button"
                autoFocus={index === autoFocusIndex}
                onClick={() => onSelect(option.path)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onOpenChange(false);
                  } else if (e.key === "Enter") {
                    e.stopPropagation();
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const buttons = Array.from(
                      listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
                    );
                    const i = buttons.indexOf(e.currentTarget);
                    if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                    else if (i > 0) buttons[i - 1].focus();
                  }
                }}
                title={option.path}
                className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left text-xs ${
                  option.path === current
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                style={{ paddingLeft: `${12 + option.depth * 12}px` }}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${option.path === current ? "bg-primary" : "bg-transparent"}`}
                />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.startDate && option.finishDate ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {option.startDate.slice(0, 10)} → {option.finishDate.slice(0, 10)}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function PriorityPicker({
  current,
  error,
  onOpenChange,
  onSelect,
  open,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (priority: number) => void;
  open: boolean;
  pending: boolean;
  shortcut?: string;
}) {
  const pickerRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);
  const options = [1, 2, 3, 4];

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Change priority"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (current ?? "—")}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
      )}
      {open ? (
        <div ref={listRef} className="absolute left-0 top-full z-30 mt-1 min-w-[96px] rounded-md border border-border bg-popover py-1 shadow-lg">
          {options.map((priority, index) => {
            const value = String(priority);
            return (
              <button
                key={priority}
                type="button"
                autoFocus={index === 0}
                onClick={() => onSelect(priority)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
                  else if (e.key === "Enter") { e.stopPropagation(); }
                  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                    const i = buttons.indexOf(e.currentTarget);
                    if (e.key === "ArrowDown") buttons[i + 1]?.focus();
                    else if (i > 0) buttons[i - 1].focus();
                  }
                }}
                className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs ${
                  value === current
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${value === current ? "bg-primary" : "bg-transparent"}`}
                />
                {priority}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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

// Marks the first case-insensitive occurrence of `query` in `text` so the
// candidate lists can show why an entry matched.
export function splitMatchSegments(
  text: string,
  query: string,
): { text: string; match: boolean }[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ text, match: false }];
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) return [{ text, match: false }];
  const segments: { text: string; match: boolean }[] = [];
  if (index > 0) segments.push({ text: text.slice(0, index), match: false });
  segments.push({ text: text.slice(index, index + trimmed.length), match: true });
  if (index + trimmed.length < text.length) {
    segments.push({ text: text.slice(index + trimmed.length), match: false });
  }
  return segments;
}

export function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatchSegments(text, query).map((segment, index) =>
        segment.match ? (
          <b key={index} className="font-bold">
            {segment.text}
          </b>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

const CANDIDATE_AVATAR_CLASSES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

export function CandidateAvatar({ displayName }: { displayName: string }) {
  let hash = 0;
  for (const char of displayName) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  const colorClass = CANDIDATE_AVATAR_CLASSES[hash % CANDIDATE_AVATAR_CLASSES.length];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colorClass}`}
    >
      {commentAuthorInitials(displayName)}
    </span>
  );
}
