import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type MultiSelectOption = { value: string; label: string };

/**
 * Inline form control for multi-value filters. Shows a trigger button styled
 * like the native `<select>`s it replaces; opening it reveals a checkbox
 * popover. Selection is an explicit array of values and an empty array means
 * "no filter" (i.e. all), so callers can treat `[]` as the unfiltered default.
 *
 * Fully keyboard-operable: open with Enter/Space/ArrowDown, move between rows
 * with the arrow keys, toggle with Enter/Space, and close with Escape — which
 * returns focus to the trigger so keyboard flow is never stranded. Navigation
 * keys are contained within the popover so any underlying grid stays put.
 */
export function MultiSelectFilter({
  options,
  selected,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  searchable = false,
  capitalize = false,
  className = "",
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown on the trigger when nothing is selected (the "all" state). */
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  searchable?: boolean;
  capitalize?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = options.length > 0 && selected.length === options.length;

  // The trigger spells out the chosen labels (not just a count) so the current
  // selection is readable at a glance; an empty selection shows the placeholder.
  const summary = useMemo(() => {
    if (selected.length === 0) return placeholder;
    const labelByValue = new Map(options.map((o) => [o.value, o.label]));
    return selected.map((value) => labelByValue.get(value) ?? value).join(", ");
  }, [options, placeholder, selected]);

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, search]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // On open, focus the search box (when present) or the first row. On close,
  // return focus to the trigger so the keyboard path resumes there.
  useEffect(() => {
    if (!open) return;
    const focusFirst = () => {
      const target = listRef.current?.querySelector<HTMLElement>(
        '[data-msf-search="true"], [data-msf-row="true"]',
      );
      target?.focus();
    };
    focusFirst();
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    setSearch("");
    if (returnFocus) triggerRef.current?.focus();
  }

  function toggle(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function moveRow(delta: number) {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-msf-row="true"]') ?? [],
    );
    if (rows.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? rows.indexOf(active) : -1;
    const next = (current + delta + rows.length) % rows.length;
    rows[next]?.focus();
  }

  function onPopoverKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveRow(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveRow(-1);
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 ${
          selected.length > 0 ? "border-primary text-foreground" : "border-input"
        } ${className || "h-9"}`}
      >
        <span
          className={`truncate ${selected.length === 0 ? "text-muted-foreground" : ""} ${
            capitalize ? "capitalize" : ""
          }`}
        >
          {summary}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selected.length > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </button>

      {open ? (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable="true"
          onKeyDown={onPopoverKeyDown}
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-52 rounded-md border border-border bg-popover shadow-lg"
        >
          {searchable ? (
            <div className="border-b border-border p-1.5">
              <input
                data-msf-search="true"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded border border-input bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          ) : null}
          <div className="flex items-center gap-1 border-b border-border p-1">
            <button
              type="button"
              onClick={() => onChange(options.map((option) => option.value))}
              disabled={allSelected}
              className="flex-1 rounded px-2 py-0.5 text-left text-xs text-muted-foreground hover:bg-secondary disabled:cursor-default disabled:opacity-40"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary disabled:cursor-default disabled:opacity-40"
            >
              Clear all
            </button>
          </div>
          <div className="max-h-56 overflow-auto p-1">
            {filteredOptions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">No values</p>
            ) : (
              filteredOptions.map((option) => {
                const checked = selectedSet.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    data-msf-row="true"
                    onClick={() => toggle(option.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        toggle(option.value);
                      }
                    }}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs outline-none hover:bg-secondary focus:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                    </span>
                    <span className={`truncate ${capitalize ? "capitalize" : ""}`}>
                      {option.label || "(empty)"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
