import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { readStoredJson, writeStoredJson } from "@/lib/storage";

// PR preview sections persist their collapsed state under a key that is separate
// from the work item preview (`wiPreviewCollapsedSections`) so the two views
// never share or clobber each other's expanded/collapsed layout.
const PR_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY =
  "azdodeck:view:prPreviewCollapsedSections:v1";

function loadCollapsedSections(): Set<string> {
  return readStoredJson(
    PR_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY,
    (raw) =>
      Array.isArray(raw)
        ? new Set(raw.filter((value): value is string => typeof value === "string"))
        : undefined,
    new Set(),
  );
}

function storeCollapsedSections(collapsed: Set<string>) {
  writeStoredJson(PR_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY, [...collapsed]);
}

// Banded, collapsible section header for the PR preview. Mirrors the work item
// preview's PreviewSection (light blue band + rotating chevron + sticky header) so
// Description / Work Items / Reviewers / Comments / System events read as one
// consistent stack. `headerAction` renders inside the band on the right (used
// for the Description edit pencil). Unlike the WIT version, the header is fully
// keyboard operable and stops its own navigation keys from reaching the grid.
export function PrPreviewSection({
  children,
  className = "",
  collapseId,
  headerAction,
  title,
}: {
  children: ReactNode;
  className?: string;
  collapseId?: string;
  headerAction?: ReactNode;
  title: string;
}) {
  const [collapsed, setCollapsed] = useState(() =>
    collapseId ? loadCollapsedSections().has(collapseId) : false,
  );

  function toggleCollapsed() {
    if (!collapseId) return;
    setCollapsed((current) => {
      const next = !current;
      const stored = loadCollapsedSections();
      if (next) stored.add(collapseId);
      else stored.delete(collapseId);
      storeCollapsedSections(stored);
      return next;
    });
  }

  // Keep toggle keys from bubbling to the preview grid behind the section so row
  // navigation doesn't also react while the header is focused. (Space/Enter
  // already activate the button; we only need to stop propagation, and stop the
  // arrow keys the grid listens to.)
  function handleHeaderKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
    } else if (event.key.startsWith("Arrow")) {
      event.stopPropagation();
    }
  }

  return (
    <section className={`min-w-0 ${className}`}>
      <div className="sticky top-0 z-10 mb-1 bg-card/95 pt-1 backdrop-blur-sm">
        <div className="flex items-center gap-1 rounded border-l-4 border-l-primary bg-blue-50 dark:bg-blue-950">
          {collapseId ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
              onKeyDown={handleHeaderKeyDown}
              className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-blue-100 focus:outline-none focus:ring-1 focus:ring-ring dark:hover:bg-blue-900"
            >
              <ChevronRight
                className={`h-3 w-3 shrink-0 text-blue-700 transition-transform dark:text-blue-300 ${
                  collapsed ? "" : "rotate-90"
                }`}
                aria-hidden="true"
              />
              <h3 className="truncate text-[11px] font-semibold uppercase tracking-wide leading-4 text-blue-900 dark:text-blue-100">
                {title}
              </h3>
            </button>
          ) : (
            <h3 className="min-w-0 flex-1 truncate px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide leading-4 text-blue-900 dark:text-blue-100">
              {title}
            </h3>
          )}
          {headerAction ? <div className="shrink-0 pr-1">{headerAction}</div> : null}
        </div>
      </div>
      {collapsed ? null : children}
    </section>
  );
}
