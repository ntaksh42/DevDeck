import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { WorkItemFieldOption } from "@/lib/azdoCommands";
import {
  extraColumnLabel,
  normalizeExtraColumns,
  MAX_VIEW_EXTRA_COLUMNS,
  type ExtraColumn,
} from "./extraColumns";

/**
 * Popover for choosing which Azure DevOps fields appear as extra grid columns
 * on screens that have no saved view to store the choice (Search, My Work
 * Items). View-backed grids configure the same thing in the view editor.
 *
 * Keyboard: opens focused on the filter input; Up/Down move through the field
 * list, Enter adds the focused field, Escape closes. On close focus returns to
 * the originating grid so keyboard navigation resumes there. Navigation keys
 * are contained so the grid behind the popover does not also react.
 */
export function ExtraColumnPicker({
  anchorRect,
  columns,
  fields,
  fieldsLoading,
  fieldsError,
  onChange,
  onClose,
}: {
  anchorRect: DOMRect;
  columns: ExtraColumn[];
  fields: WorkItemFieldOption[];
  fieldsLoading: boolean;
  fieldsError: string | null;
  onChange: (columns: ExtraColumn[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");

  const selected = useMemo(
    () => new Set(columns.map((column) => column.referenceName.toLowerCase())),
    [columns],
  );
  const atLimit = columns.length >= MAX_VIEW_EXTRA_COLUMNS;
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return fields
      .filter((field) => !selected.has(field.referenceName.toLowerCase()))
      .filter(
        (field) =>
          needle.length === 0 ||
          field.name.toLowerCase().includes(needle) ||
          field.referenceName.toLowerCase().includes(needle),
      )
      .slice(0, 100);
  }, [fields, filter, selected]);

  // Focus the filter input on open, and again on the next frame: the grid and
  // preview pane both restore focus asynchronously after a re-render, and would
  // otherwise pull it back out of the popover.
  useEffect(() => {
    inputRef.current?.focus();
    const retry = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(retry);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[data-primary-grid="true"]')?.focus();
      }, 0);
    };
  }, []);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  // Capture-phase handling so navigation keys act on the popover and never
  // reach the grid behind it, even in the frame before focus lands inside.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      event.stopPropagation();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function moveFocus(delta: number) {
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[data-extracol-item="true"]') ?? [],
    );
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? items.indexOf(active) : -1;
    // From the filter input (index -1), Down lands on the first option and Up
    // wraps to the last.
    const next = current === -1 && delta < 0 ? items.length - 1 : (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  function addColumn(field: WorkItemFieldOption) {
    if (atLimit) return;
    onChange(
      normalizeExtraColumns([
        ...columns,
        { referenceName: field.referenceName, fieldType: field.fieldType },
      ]),
    );
    setFilter("");
    inputRef.current?.focus();
  }

  function removeColumn(referenceName: string) {
    onChange(columns.filter((column) => column.referenceName !== referenceName));
  }

  const top = Math.min(anchorRect.bottom + 2, window.innerHeight - 360);
  const left = Math.min(anchorRect.left, window.innerWidth - 304);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Extra columns"
      className="fixed z-50 flex w-72 flex-col rounded-md border border-border bg-popover p-1 shadow-lg"
      style={{ top, left }}
      onKeyDown={(event) => {
        // Arrow keys are handled in the capture-phase listener above; here only
        // keep Enter/Space from also reaching the grid behind the popover.
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
    >
      <div className="border-b border-border px-2 py-1.5 text-xs font-semibold text-foreground">
        Extra columns
      </div>

      {columns.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-b border-border p-1.5">
          {columns.map((column) => (
            <span
              key={column.referenceName}
              className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 text-[11px]"
              title={column.referenceName}
            >
              <span className="truncate">{extraColumnLabel(column.referenceName)}</span>
              <button
                type="button"
                data-extracol-item="true"
                aria-label={`Remove column ${column.referenceName}`}
                onClick={() => removeColumn(column.referenceName)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="p-1.5">
        <input
          ref={inputRef}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter fields…"
          aria-label="Filter fields"
          disabled={atLimit}
          className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
      </div>

      <div className="max-h-56 overflow-y-auto p-1">
        {fieldsError ? (
          <p className="px-2 py-1 text-xs text-destructive">{fieldsError}</p>
        ) : fieldsLoading ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">Loading fields…</p>
        ) : atLimit ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            Maximum of {MAX_VIEW_EXTRA_COLUMNS} extra columns reached.
          </p>
        ) : matches.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No fields matched.</p>
        ) : (
          matches.map((field) => (
            <button
              key={field.referenceName}
              type="button"
              data-extracol-item="true"
              onClick={() => addColumn(field)}
              title={field.referenceName}
              className="flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <span className="w-full truncate text-xs">{field.name}</span>
              <span className="w-full truncate font-mono text-[10px] text-muted-foreground">
                {field.referenceName}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
