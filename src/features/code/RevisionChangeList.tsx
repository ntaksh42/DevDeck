import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { RevisionChange } from "@/lib/azdoCommands";
import { handleRowNavKey } from "./codeBrowseShared";

const CHANGE_LABELS: Record<string, { label: string; className: string }> = {
  add: { label: "A", className: "text-green-700 dark:text-green-400" },
  edit: { label: "M", className: "text-amber-700 dark:text-amber-400" },
  delete: { label: "D", className: "text-red-700 dark:text-red-400" },
  rename: { label: "R", className: "text-blue-700 dark:text-blue-400" },
};

function changeBadge(changeType: string) {
  const key = changeType.toLowerCase().split(",")[0].trim();
  return CHANGE_LABELS[key] ?? { label: "?", className: "text-muted-foreground" };
}

// The files changed between two revisions. Each row is a button; arrow keys
// (or J / K, Home / End) move between rows and Enter / Space opens its diff.
export function RevisionChangeList({
  changes,
  truncated,
  selectedPath,
  onSelect,
}: {
  changes: RevisionChange[];
  truncated: boolean;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const containerRef = useRef<HTMLUListElement | null>(null);

  function onKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    handleRowNavKey(event, containerRef.current, "[data-compare-file]");
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        {changes.length} file{changes.length === 1 ? "" : "s"} changed
        {truncated ? " (list truncated by the server)" : ""}
      </div>
      <ul
        ref={containerRef}
        aria-label="Changed files"
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {changes.map((change) => {
          const badge = changeBadge(change.changeType);
          const selected = change.path === selectedPath;
          return (
            <li key={change.path}>
              <button
                type="button"
                data-compare-file
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(change.path)}
                title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path}
                className={`flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  selected ? "bg-secondary" : "hover:bg-muted/50"
                }`}
              >
                <span className={`w-3 shrink-0 font-mono font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{change.path}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
