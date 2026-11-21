import { useRef, type KeyboardEvent } from "react";
import { Star, X } from "lucide-react";
import { focusFilterInput, isEditableTarget } from "@/lib/utils";
import { PreviewEmptyState, SEARCH_EMPTY_HINT } from "@/components/StateDisplay";

export type SearchHistoryRow = {
  id: string;
  primary: string;
  secondary?: string;
  time?: string;
};

export type SearchHistoryKind = "recent" | "saved" | "viewed";

export type SearchHistorySection = {
  /** "recent" rows can be pinned; "recent" and "saved" rows can be removed. */
  kind: SearchHistoryKind;
  title: string;
  rows: SearchHistoryRow[];
};

export const SEARCH_HISTORY_HINT = "↑↓ to select · Enter to run · / to focus search";

const iconButton =
  "rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Empty-state lists for the Search views. Rows use a roving tabindex: ↑/↓ move,
 * Enter runs, S pins a recent search, Delete removes it. Each row also has
 * ★ / ✕ buttons for the same actions.
 */
export function SearchHistoryPanel({
  sections,
  emptyMessage,
  onRun,
  onPin,
  onRemove,
}: {
  sections: SearchHistorySection[];
  emptyMessage: string;
  onRun: (kind: SearchHistoryKind, id: string) => void;
  onPin: (id: string) => void;
  onRemove: (kind: "recent" | "saved", id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = sections.filter((s) => s.rows.length > 0);

  const rowEls = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-history-row]") ?? []);

  function focusRow(index: number) {
    const rows = rowEls();
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (row) row.focus();
    else focusFilterInput();
  }

  function removeRow(kind: "recent" | "saved", id: string, row: HTMLElement) {
    const index = rowEls().indexOf(row);
    const hadFocus = row.contains(document.activeElement);
    onRemove(kind, id);
    if (hadFocus) requestAnimationFrame(() => focusRow(index));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (event.key === "/") {
      event.preventDefault();
      focusFilterInput();
      return;
    }
    const row = target.closest<HTMLElement>("[data-history-row]");
    if (!row) return;
    const kind = row.dataset.kind as SearchHistoryKind;
    const id = row.dataset.id ?? "";
    const index = rowEls().indexOf(row);
    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      focusRow(index + 1);
    } else if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      focusRow(index - 1);
    } else if (event.key === "Enter" && target === row) {
      event.preventDefault();
      onRun(kind, id);
    } else if ((event.key === "s" || event.key === "S") && kind === "recent") {
      event.preventDefault();
      onPin(id);
    } else if (event.key === "Delete" && kind !== "viewed") {
      event.preventDefault();
      removeRow(kind, id, row);
    }
  }

  if (visible.length === 0) {
    return <PreviewEmptyState message={emptyMessage} hint={SEARCH_EMPTY_HINT} />;
  }

  let first = true;
  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        {visible.map((section) => (
          <section key={section.kind} aria-label={section.title}>
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h3>
            <ul>
              {section.rows.map((row) => {
                const isFirst = first;
                first = false;
                return (
                  <li key={row.id}>
                    <div
                      data-history-row
                      data-kind={section.kind}
                      data-id={row.id}
                      tabIndex={isFirst ? 0 : -1}
                      onClick={() => onRun(section.kind, row.id)}
                      onFocus={(e) => {
                        // Roving tabindex: the focused row becomes the tab stop.
                        rowEls().forEach((el) => (el.tabIndex = el === e.currentTarget ? 0 : -1));
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary focus:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <span className="min-w-0 flex-1 truncate">{row.primary}</span>
                      {row.secondary ? (
                        <span className="shrink-0 truncate text-xs text-muted-foreground">{row.secondary}</span>
                      ) : null}
                      {row.time ? <span className="shrink-0 text-xs text-muted-foreground">{row.time}</span> : null}
                      {section.kind === "recent" ? (
                        <button
                          type="button"
                          aria-label={`Save search ${row.primary}`}
                          title="Save (S)"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPin(row.id);
                          }}
                          className={iconButton}
                        >
                          <Star className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                      {section.kind !== "viewed" ? (
                        <button
                          type="button"
                          aria-label={`Remove search ${row.primary}`}
                          title="Remove (Delete)"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRow(
                              section.kind as "recent" | "saved",
                              row.id,
                              e.currentTarget.closest<HTMLElement>("[data-history-row]")!,
                            );
                          }}
                          className={iconButton}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <p className="text-center text-xs text-muted-foreground/80">{SEARCH_HISTORY_HINT}</p>
      </div>
    </div>
  );
}
