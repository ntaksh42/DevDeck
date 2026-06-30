import { Loader2, RotateCcw } from "lucide-react";
import type { TimelineNode } from "@/lib/azdoCommands";
import { formatDuration, pipelineRunVisual, runToneClasses } from "./pipelineStatus";

type TreeNode = TimelineNode & { children: TreeNode[] };

function buildTimelineTree(nodes: TimelineNode[]): TreeNode[] {
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

function TimelineRow({
  node,
  depth,
  selectedLogId,
  onSelectLog,
  onRetryStage,
  retryingStageRef,
  retryDisabled,
}: {
  node: TreeNode;
  depth: number;
  selectedLogId: number | null;
  onSelectLog: (logId: number) => void;
  onRetryStage: (stageRefName: string) => void;
  retryingStageRef: string | null;
  retryDisabled: boolean;
}) {
  const visual = pipelineRunVisual(node.state, node.result);
  const hasLog = node.logId != null;
  const isSelected = hasLog && node.logId === selectedLogId;
  // Only completed stages that failed can be retried, and only when the stage
  // exposes its ref name (its `identifier`).
  const canRetry =
    node.nodeType === "Stage" &&
    node.result === "failed" &&
    !!node.identifier &&
    !retryDisabled;
  const retrying = !!node.identifier && retryingStageRef === node.identifier;
  return (
    <>
      <div
        className={`flex w-full items-center border-b border-border ${
          isSelected ? "bg-secondary" : ""
        }`}
      >
        <button
          type="button"
          disabled={!hasLog}
          onClick={() => hasLog && onSelectLog(node.logId as number)}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          className={`flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
            hasLog ? "hover:bg-muted/50" : "cursor-default"
          }`}
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
        {canRetry ? (
          <button
            type="button"
            disabled={retrying}
            onClick={() => onRetryStage(node.identifier as string)}
            title={`Retry the ${node.name ?? "stage"} stage's failed jobs`}
            aria-label={`Retry the ${node.name ?? "stage"} stage's failed jobs`}
            className="mr-2 inline-flex h-6 shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Retry
          </button>
        ) : null}
      </div>
      {node.children.map((child) => (
        <TimelineRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedLogId={selectedLogId}
          onSelectLog={onSelectLog}
          onRetryStage={onRetryStage}
          retryingStageRef={retryingStageRef}
          retryDisabled={retryDisabled}
        />
      ))}
    </>
  );
}

export function PipelineTimeline({
  timeline,
  timelineUnavailable,
  selectedLogId,
  onSelectLog,
  onRetryStage,
  retryingStageRef,
  retryDisabled,
}: {
  timeline: TimelineNode[];
  timelineUnavailable: boolean;
  selectedLogId: number | null;
  onSelectLog: (logId: number) => void;
  onRetryStage: (stageRefName: string) => void;
  retryingStageRef: string | null;
  retryDisabled: boolean;
}) {
  const tree = buildTimelineTree(timeline);

  if (tree.length === 0) {
    return timelineUnavailable ? (
      <p className="px-3 py-3 text-xs text-amber-700 dark:text-amber-400">
        Failed to load the timeline. It may be a transient error — try refreshing.
      </p>
    ) : (
      <p className="px-3 py-3 text-xs text-muted-foreground">No timeline available.</p>
    );
  }

  return (
    <>
      {tree.map((node) => (
        <TimelineRow
          key={node.id}
          node={node}
          depth={0}
          selectedLogId={selectedLogId}
          onSelectLog={onSelectLog}
          onRetryStage={onRetryStage}
          retryingStageRef={retryingStageRef}
          retryDisabled={retryDisabled}
        />
      ))}
    </>
  );
}
