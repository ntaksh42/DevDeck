import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ClassificationNodeOption } from "@/lib/azdoCommands";
import { useCloseOnOutsidePointer } from "./PreviewEditorsBase";

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
