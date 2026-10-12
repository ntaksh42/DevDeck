import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ListStatusBar, itemCount } from "@/components/ListStatusBar";
import { PreviewEmptyState } from "@/components/StateDisplay";
import type { AnalyzeGroup } from "./analyzeGroupsStorage";

export type AnalyzeGroupListProps = {
  groups: AnalyzeGroup[];
  selectedId: string | null;
  onSelect: (groupId: string) => void;
  /** Moves focus into the detail pane, mirroring Enter on a grid row. */
  onOpen: () => void;
  onAdd: () => void;
  onEdit: (groupId: string) => void;
  onDelete: (groupId: string) => void;
};

export function AnalyzeGroupList({
  groups,
  selectedId,
  onSelect,
  onOpen,
  onAdd,
  onEdit,
  onDelete,
}: AnalyzeGroupListProps) {
  const rowRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const selectedIndex = groups.findIndex((group) => group.id === selectedId);

  useEffect(() => {
    // Drop refs for groups that no longer exist so the map cannot grow forever.
    const ids = new Set(groups.map((group) => group.id));
    for (const id of [...rowRefs.current.keys()]) {
      if (!ids.has(id)) rowRefs.current.delete(id);
    }
  }, [groups]);

  function focusAt(index: number) {
    const group = groups[index];
    if (!group) return;
    onSelect(group.id);
    rowRefs.current.get(group.id)?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
      case "j":
      case "J":
        focusAt(Math.min(index + 1, groups.length - 1));
        break;
      case "ArrowUp":
      case "k":
      case "K":
        focusAt(Math.max(index - 1, 0));
        break;
      case "Home":
        focusAt(0);
        break;
      case "End":
        focusAt(groups.length - 1);
        break;
      case "Enter":
        onOpen();
        break;
      case "n":
      case "N":
        onAdd();
        break;
      case "e":
      case "E":
        if (groups[index]) onEdit(groups[index].id);
        break;
      case "Delete":
        if (groups[index]) onDelete(groups[index].id);
        break;
      default:
        handled = false;
    }
    if (handled) {
      // Keep navigation inside the list so the detail pane does not also react.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-card"
      data-primary-grid="true"
      tabIndex={-1}
      onKeyDown={(event) => {
        // With no rows the container itself holds focus, so it owns "N".
        if (groups.length === 0 && (event.key === "n" || event.key === "N")) {
          event.preventDefault();
          event.stopPropagation();
          onAdd();
        }
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <PreviewEmptyState
            message="No groups yet."
            hint="Press N to add one and track a set of queries together."
          />
        ) : (
          groups.map((group, index) => {
            const selected = group.id === selectedId;
            return (
              <button
                key={group.id}
                ref={(element) => {
                  rowRefs.current.set(group.id, element);
                }}
                type="button"
                aria-current={selected ? "true" : undefined}
                data-pane-focus-row="true"
                tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
                onClick={() => onSelect(group.id)}
                onDoubleClick={onOpen}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "border-primary bg-secondary font-semibold"
                    : "border-transparent hover:bg-muted/70"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  {group.queries.length} {group.queries.length === 1 ? "query" : "queries"} ·{" "}
                  {group.granularity === "day" ? "Day" : "Week"}
                </span>
              </button>
            );
          })
        )}
      </div>

      <ListStatusBar summary={[itemCount(groups.length)]} />
    </div>
  );
}
