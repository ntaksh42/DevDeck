import { type TimelineNode } from "@/lib/azdoCommands";
import { formatDuration, pipelineRunVisual, runToneClasses } from "./pipelineStatus";

export type TreeNode = TimelineNode & { children: TreeNode[] };

export function buildTimelineTree(nodes: TimelineNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (list: TreeNode[]) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const node of list) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

// Pre-order traversal matching TimelineRow's render order, so a flat cursor
// index lines up with the rows as displayed (stage -> job -> task).
export function flattenTimelineTree(nodes: TreeNode[]): TreeNode[] {
  const flat: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return flat;
}

export function TimelineRow({
  node,
  depth,
  selectedLogId,
  cursorId,
  onSelectLog,
  registerRow,
}: {
  node: TreeNode;
  depth: number;
  selectedLogId: number | null;
  cursorId: string | null;
  onSelectLog: (logId: number) => void;
  registerRow: (id: string, el: HTMLButtonElement | null) => void;
}) {
  const visual = pipelineRunVisual(node.state, node.result);
  const hasLog = node.logId != null;
  const isSelected = hasLog && node.logId === selectedLogId;
  const isCursor = node.id === cursorId;
  return (
    <>
      <button
        type="button"
        ref={(el) => registerRow(node.id, el)}
        disabled={!hasLog}
        onClick={() => hasLog && onSelectLog(node.logId as number)}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        className={`flex w-full items-center gap-2 border-b border-border py-1 pr-2 text-left text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
          hasLog ? "hover:bg-muted/50" : "cursor-default"
        } ${isSelected || isCursor ? "bg-secondary" : ""}`}
      >
        <span
          className={`inline-flex w-fit shrink-0 items-center rounded px-1.5 py-px text-[11px] font-medium ${runToneClasses(
            visual.tone,
          )}`}
        >
          {visual.label}
        </span>
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
      </button>
      {node.children.map((child) => (
        <TimelineRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedLogId={selectedLogId}
          cursorId={cursorId}
          onSelectLog={onSelectLog}
          registerRow={registerRow}
        />
      ))}
    </>
  );
}
