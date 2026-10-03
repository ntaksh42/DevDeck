import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Search, X } from 'lucide-react';

export type DockFilterChip = { label: string; onClear: () => void; onEdit?: () => void };

function FilterChip({ label, onEdit, onClear }: DockFilterChip) {
  return (
    <span className="inline-flex h-4 max-w-[12rem] items-center rounded-full bg-primary/10 text-[11px] text-link">
      <button type="button" onClick={onEdit} disabled={!onEdit} className="truncate pl-2 pr-1 disabled:cursor-default">
        {label}
      </button>
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`} className="pr-1.5 hover:text-foreground">
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * Open/closed state for a `DockFilterBar`. `returnFocus` runs after the bar
 * folds on Escape/close so keyboard navigation resumes in the grid.
 */
export function useDockFilter(inputRef: RefObject<HTMLInputElement | null>, returnFocus: () => void) {
  const [open, setOpen] = useState(false);
  return {
    open,
    onOpen() {
      if (open) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        setOpen(true);
      }
    },
    onClose(focusBack: boolean) {
      setOpen(false);
      if (focusBack) window.setTimeout(returnFocus, 0);
    },
  };
}

/**
 * A grid filter that lives in the dock tab strip. It stays folded to a small
 * "Ctrl+F" button until asked for, and folds back on Escape; while folded, any
 * value in effect is still shown as a clearable chip. `children` is the open
 * state's controls (the input bound to `inputRef`, plus any toggles).
 */
export function DockFilterBar({
  label,
  open,
  onOpen,
  onClose,
  inputRef,
  hasValue,
  chips,
  children,
}: {
  /** What is being filtered, for the button's accessible name ("Filter reviews"). */
  label: string;
  open: boolean;
  onOpen: () => void;
  /** `returnFocus` is false when focus already moved elsewhere (blur). */
  onClose: (returnFocus: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Keeps the bar open on blur while a value is typed. */
  hasValue: boolean;
  chips: DockFilterChip[];
  children: ReactNode;
}) {
  const revealRef = useRef<HTMLButtonElement | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
  }, []);
  // Keyboard users must never be stranded on <body>: when the grid has no row
  // to take focus back (e.g. the filter matched nothing) or a clicked chip
  // disappears, focus lands on the "Ctrl+F" button instead.
  function keepFocusInStrip() {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      if (document.activeElement === document.body || !document.activeElement) revealRef.current?.focus();
    }, 50);
  }

  // Focus as soon as the input exists, so keys typed right after Ctrl+F go
  // into the filter instead of reaching the grid's single-key shortcuts.
  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, inputRef]);

  if (!open) {
    return (
      <div className="flex h-full min-w-0 items-center gap-1 pr-1">
        {chips.map((chip) => (
          <FilterChip
            key={chip.label}
            {...chip}
            onClear={() => {
              chip.onClear();
              revealRef.current?.focus();
            }}
          />
        ))}
        <button
          ref={revealRef}
          type="button"
          onClick={onOpen}
          data-filter-reveal="true"
          aria-label={label}
          title={`${label} (Ctrl+F or /)`}
          className="flex h-4 items-center gap-1 rounded border border-border bg-card px-1.5 text-[11px] text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <Search className="h-3 w-3" aria-hidden="true" />
          Ctrl+F
        </button>
      </div>
    );
  }

  return (
    // Ctrl+F while already open "clicks" this wrapper (see `focusFilterInput`);
    // only that programmatic click (target === wrapper) re-focuses the input.
    <div
      data-filter-reveal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) inputRef.current?.focus();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
          keepFocusInStrip();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !hasValue) onClose(false);
      }}
      className="flex h-full items-center gap-1.5 pr-1"
    >
      {children}
      <button
        type="button"
        onClick={() => {
          onClose(true);
          keepFocusInStrip();
        }}
        aria-label="Close filter"
        title="Close filter (Esc)"
        className="rounded text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Compact smart-filter input sized for the 20px tab strip. */
export function DockFilterInput({
  inputRef,
  value,
  onChange,
  placeholder,
  ariaLabel,
  title,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  title?: string;
}) {
  return (
    <div className="flex h-[18px] w-64 items-center rounded-md border border-input bg-background px-1.5 focus-within:ring-2 focus-within:ring-ring">
      <Search className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        title={title}
        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
