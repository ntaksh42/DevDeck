import type { KeyboardEvent, ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown, Loader2, Search, SlidersHorizontal } from "lucide-react";

/*
 * Building blocks for the search screens' filter strip (PR search, work item
 * search, commits). Every screen uses the same shape: one wrapping row of
 * unlabeled 32px controls — search box, scope pickers, a "Filters" disclosure
 * for the rarely used conditions, and the Search button — with the disclosed
 * conditions on a second row below.
 */

export const searchBarRowClass = "flex flex-wrap items-center gap-2";

export function SearchInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  ariaLabel = "Search",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex h-8 min-w-[200px] flex-1 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
      <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  );
}

export function FiltersToggle({
  open,
  onToggle,
  count,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  /** Number of disclosed conditions currently set; shown as a badge. */
  count: number;
  /** id of the disclosed row. */
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      Filters
      {count > 0 ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-none text-primary-foreground">
          {count}
        </span>
      ) : null}
      <ChevronDown
        className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

export function SearchSubmitButton({ pending, disabled }: { pending: boolean; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      Search
    </button>
  );
}

/** A small caption + control pair for the disclosed "Filters" row. */
export function FilterField({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-0.5 ${className}`}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export const filterInputClass =
  "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Native `<select>` drawn like the custom MultiSelectFilter trigger (same
 * border, padding and chevron), keeping the platform's keyboard behavior.
 */
export function NativeSelect({
  className = "",
  compact = false,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  /** 28px / text-xs, for dense toolbars. */
  compact?: boolean;
}) {
  return (
    <span className={`relative inline-flex min-w-0 ${className}`}>
      <select
        {...props}
        className={`w-full min-w-0 appearance-none rounded-md border border-input bg-background pl-2 pr-7 outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 ${
          compact ? "h-7 text-xs" : "h-8 text-sm"
        }`}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </span>
  );
}
