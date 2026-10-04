import { ChevronDown, ChevronRight } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useRef, useState } from "react";
import { RunBadge } from "./PipelineRunBadge";
import { formatDuration, pipelineRunVisual } from "./pipelineStatus";
import { flattenVisible, type TreeNode } from "./pipelineTimelineTree";

// Stage / Job / Task tree following the WAI-ARIA tree pattern: one roving Tab
// stop, Up/Down to move, Right/Left to expand/collapse (Left on a top-level
// collapsed row is left to the preview, which returns focus to the grid),
// Enter/Space to open the node's log.
export function PipelineTimeline({
  tree,
  expanded,
  onToggle,
  selectedLogId,
  onSelectLog,
}: {
  tree: TreeNode[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedLogId: number | null;
  onSelectLog: (logId: number) => void;
}) {
  const rows = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const selectedRowId = rows.find((row) => row.node.logId != null && row.node.logId === selectedLogId)?.node.id;
  // The Tab entry point: the row last focused, else the selected node, else the first.
  const tabbableId =
    (focusedId && rows.some((row) => row.node.id === focusedId) ? focusedId : null) ??
    selectedRowId ??
    rows[0]?.node.id ??
    null;

  function focusRow(id: string | null | undefined) {
    if (!id) return;
    setFocusedId(id);
    containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const index = rows.findIndex((row) => row.node.id === rowEl?.dataset.nodeId);
    if (index < 0) return;
    const { node, parentId } = rows[index];
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    switch (event.key) {
      case "ArrowDown":
        consume();
        focusRow(rows[Math.min(index + 1, rows.length - 1)]?.node.id);
        break;
      case "ArrowUp":
        consume();
        focusRow(rows[Math.max(index - 1, 0)]?.node.id);
        break;
      case "Home":
        consume();
        focusRow(rows[0]?.node.id);
        break;
      case "End":
        consume();
        focusRow(rows[rows.length - 1]?.node.id);
        break;
      case "ArrowRight":
        consume();
        if (hasChildren && !isOpen) onToggle(node.id);
        else if (hasChildren) focusRow(rows[index + 1]?.node.id);
        break;
      case "ArrowLeft":
        if (hasChildren && isOpen) {
          consume();
          onToggle(node.id);
        } else if (parentId) {
          consume();
          focusRow(parentId);
        }
        break;
      case "Enter":
      case " ":
        consume();
        if (node.logId != null) onSelectLog(node.logId);
        break;
    }
  }

  return (
    <div ref={containerRef} role="tree" aria-label="Run timeline" onKeyDown={handleKeyDown}>
      {rows.map(({ node, depth }) => {
        const visual = pipelineRunVisual(node.state, node.result);
        const hasLog = node.logId != null;
        const hasChildren = node.children.length > 0;
        const isOpen = expanded.has(node.id);
        const isSelected = hasLog && node.logId === selectedLogId;
        return (
          <div
            key={node.id}
            role="treeitem"
            data-node-id={node.id}
            aria-level={depth + 1}
            aria-expanded={hasChildren ? isOpen : undefined}
            aria-selected={isSelected}
            tabIndex={node.id === tabbableId ? 0 : -1}
            onFocus={() => setFocusedId(node.id)}
            onClick={() => {
              if (hasLog) onSelectLog(node.logId as number);
              else if (hasChildren) onToggle(node.id);
            }}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            className={`flex w-full items-center gap-1.5 border-b border-border py-1 pr-2 text-left text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
              hasLog || hasChildren ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
            } ${isSelected ? "bg-secondary" : ""}`}
          >
            {hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name ?? "node"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(node.id);
                }}
                className="shrink-0 rounded text-muted-foreground hover:text-foreground"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="inline-block w-3.5 shrink-0" aria-hidden="true" />
            )}
            <RunBadge visual={visual} size="xs" />
            <span className="truncate">{node.name ?? "(unnamed)"}</span>
            {node.errorCount > 0 ? (
              <span className="shrink-0 text-xs text-red-700 dark:text-red-400">{node.errorCount} err</span>
            ) : null}
            {node.warningCount > 0 ? (
              <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">{node.warningCount} warn</span>
            ) : null}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatDuration(node.startTime, node.finishTime)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
