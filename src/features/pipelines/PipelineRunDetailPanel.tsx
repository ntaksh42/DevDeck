import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, Play, Square } from "lucide-react";
import {
  cancelPipelineRun,
  commandErrorMessage,
  getAppSettings,
  getPipelineRun,
  getPipelineRunLogTail,
  rerunPipelineRun,
  type PipelineRunDetail,
  type TimelineNode,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { focusPrimaryGrid, formatDate, isEditableTarget } from "@/lib/utils";
import {
  formatDuration,
  isInProgressStatus,
  pipelineRunVisual,
  runToneClasses,
  shortBranch,
} from "./pipelineStatus";

const LOG_REFRESH_INTERVAL_MS = 15_000;

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
}: {
  node: TreeNode;
  depth: number;
  selectedLogId: number | null;
  onSelectLog: (logId: number) => void;
}) {
  const visual = pipelineRunVisual(node.state, node.result);
  const hasLog = node.logId != null;
  const isSelected = hasLog && node.logId === selectedLogId;
  return (
    <>
      <button
        type="button"
        disabled={!hasLog}
        onClick={() => hasLog && onSelectLog(node.logId as number)}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        className={`flex w-full items-center gap-2 border-b border-border py-1 pr-2 text-left text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
          hasLog ? "hover:bg-muted/50" : "cursor-default"
        } ${isSelected ? "bg-secondary" : ""}`}
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
          <span className="shrink-0 text-xs text-red-700">{node.errorCount} err</span>
        ) : null}
        {node.warningCount > 0 ? (
          <span className="shrink-0 text-xs text-amber-700">{node.warningCount} warn</span>
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
          onSelectLog={onSelectLog}
        />
      ))}
    </>
  );
}

export function PipelineRunDetailPanel({
  organizationId,
  projectId,
  buildId,
}: {
  organizationId: string;
  projectId: string;
  buildId: number | null;
}) {
  const queryClient = useQueryClient();
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

  const appSettingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const readOnly = appSettingsQuery.data?.readOnlyValidationModeEnabled ?? false;

  const runQuery = useQuery({
    queryKey: ["pipelineRun", organizationId, projectId, buildId],
    queryFn: () =>
      getPipelineRun({ organizationId, projectId, buildId: buildId as number }),
    enabled: buildId != null && !!projectId,
    refetchInterval: (query) => {
      const data = query.state.data as PipelineRunDetail | undefined;
      return data && isInProgressStatus(data.run.status) ? LOG_REFRESH_INTERVAL_MS : false;
    },
  });
  const detail = runQuery.data ?? null;
  const run = detail?.run ?? null;

  const tree = useMemo(
    () => (detail ? buildTimelineTree(detail.timeline) : []),
    [detail],
  );

  const logQuery = useQuery({
    queryKey: ["pipelineRunLog", organizationId, projectId, buildId, selectedLogId],
    queryFn: () =>
      getPipelineRunLogTail({
        organizationId,
        projectId,
        buildId: buildId as number,
        logId: selectedLogId as number,
      }),
    enabled: buildId != null && selectedLogId != null,
  });

  const rerun = useMutation({
    mutationFn: () =>
      rerunPipelineRun({
        organizationId,
        projectId,
        definitionId: run!.definitionId as number,
        sourceBranch: run!.sourceBranch as string,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["pipelineRuns", organizationId, projectId],
      });
    },
  });

  const cancel = useMutation({
    mutationFn: () => cancelPipelineRun({ organizationId, projectId, buildId: buildId as number }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["pipelineRun", organizationId, projectId, buildId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["pipelineRuns", organizationId, projectId],
      });
    },
  });

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  const canRerun = !!run && run.definitionId != null && run.sourceBranch != null;
  const canCancel = !!run && isInProgressStatus(run.status);

  function onRerunClick() {
    if (!run) return;
    const branch = shortBranch(run.sourceBranch);
    if (window.confirm(`Queue a new run of ${run.definitionName ?? "this pipeline"} on ${branch}?`)) {
      rerun.mutate();
    }
  }

  function onCancelClick() {
    if (window.confirm("Cancel this run?")) cancel.mutate();
  }

  const visual = run ? pipelineRunVisual(run.status, run.result) : null;
  const mutationError = rerun.error ?? cancel.error;

  return (
    <aside
      onKeyDown={handleKeyDown}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-white focus-within:ring-2 focus-within:ring-ring"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        data-primary-preview="true"
        aria-keyshortcuts="Alt+P"
        tabIndex={-1}
      >
        {buildId == null ? (
          <div className="flex h-full items-center justify-center px-3 text-sm text-muted-foreground">
            Select a run.
          </div>
        ) : runQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 px-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading run…
          </div>
        ) : runQuery.isError || !run || !visual ? (
          <div className="px-3 py-4 text-sm text-destructive">
            {commandErrorMessage(runQuery.error) || "Run unavailable."}
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex w-fit items-center rounded px-1.5 py-px text-xs font-medium ${runToneClasses(
                    visual.tone,
                  )}`}
                >
                  {visual.label}
                </span>
                <span className="truncate font-semibold" title={run.definitionName ?? undefined}>
                  {run.definitionName ?? "Pipeline"}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {run.buildNumber ?? run.buildId}
                </span>
                <button
                  type="button"
                  onClick={() => openExternalUrl(run.webUrl)}
                  title="Open in Azure DevOps"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border bg-white px-1.5 py-px text-[11px] text-primary hover:bg-secondary"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" /> Open
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>Branch</dt>
                <dd className="truncate text-foreground" title={run.sourceBranch ?? undefined}>
                  {shortBranch(run.sourceBranch)}
                </dd>
                <dt>Reason</dt>
                <dd className="text-foreground">{run.reason ?? "—"}</dd>
                <dt>Requested for</dt>
                <dd className="text-foreground">{run.requestedFor ?? "—"}</dd>
                <dt>Queued</dt>
                <dd className="text-foreground">
                  {run.queueTime ? formatDate(run.queueTime) : "—"}
                </dd>
                <dt>Duration</dt>
                <dd className="text-foreground">
                  {formatDuration(run.startTime, run.finishTime)}
                </dd>
              </dl>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRerunClick}
                  disabled={!canRerun || readOnly || rerun.isPending}
                  title={readOnly ? "Read-only validation mode is enabled" : undefined}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rerun.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Re-run
                </button>
                {canCancel ? (
                  <button
                    type="button"
                    onClick={onCancelClick}
                    disabled={readOnly || cancel.isPending}
                    title={readOnly ? "Read-only validation mode is enabled" : undefined}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancel.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Cancel
                  </button>
                ) : null}
              </div>
              {mutationError ? (
                <p role="alert" className="mt-2 flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {commandErrorMessage(mutationError)}
                </p>
              ) : null}
            </div>

            <div className="border-b border-border">
              {tree.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground">No timeline available.</p>
              ) : (
                tree.map((node) => (
                  <TimelineRow
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedLogId={selectedLogId}
                    onSelectLog={setSelectedLogId}
                  />
                ))
              )}
            </div>

            {selectedLogId != null ? (
              <div className="px-3 py-2">
                {logQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading log…</p>
                ) : logQuery.isError ? (
                  <p className="text-xs text-destructive">
                    {commandErrorMessage(logQuery.error) || "Log unavailable."}
                  </p>
                ) : (
                  <>
                    {logQuery.data?.truncated ? (
                      <p className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        Showing last {logQuery.data.lines.length} lines.
                        <button
                          type="button"
                          onClick={() => openExternalUrl(run.webUrl)}
                          className="text-primary hover:underline"
                        >
                          Full log in Azure DevOps
                        </button>
                      </p>
                    ) : null}
                    <pre className="max-h-64 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[11px] leading-relaxed text-zinc-100">
                      {logQuery.data?.lines.join("\n") || "(empty log)"}
                    </pre>
                  </>
                )}
              </div>
            ) : (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Select a stage or job to view its log tail.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
