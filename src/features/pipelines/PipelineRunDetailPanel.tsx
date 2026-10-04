import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Loader2, Play, Square } from "lucide-react";
import {
  cancelPipelineRun,
  commandErrorMessage,
  getAppSettings,
  getPipelineRun,
  getPipelineRunLogTail,
  listPipelineArtifacts,
  rerunPipelineRun,
  type PipelineRunDetail,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { focusPrimaryGrid, formatDate, formatRelativeDate, isEditableTarget } from "@/lib/utils";
import { formatDuration, isInProgressStatus, pipelineRunVisual, shortBranch } from "./pipelineStatus";
import {
  allBranchIds,
  ancestorIdsOfLog,
  buildTimelineTree,
  defaultExpandedIds,
  findFirstFailure,
  findNodeByLogId,
} from "./pipelineTimelineTree";
import { PipelineConfirmBar } from "./PipelineConfirmBar";
import { PipelineLogViewer } from "./PipelineLogViewer";
import { RunBadge } from "./PipelineRunBadge";
import { PipelineTimeline } from "./PipelineTimeline";
import { PipelineTestResultsPanel } from "./PipelineTestResultsPanel";
import { PipelineStageRetryPanel } from "./PipelineStageRetryPanel";
import { PreviewEmptyState, SELECT_EMPTY_HINT } from "@/components/StateDisplay";
import { PreviewBand } from "@/components/PreviewBand";
import { PreviewToolbarPortal } from "@/components/PreviewToolbarSlot";

const LOG_REFRESH_INTERVAL_MS = 15_000;
const NO_LINES: string[] = [];

const TOOLBAR_BUTTON =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const BAND_BUTTON =
  "inline-flex h-5 items-center gap-1 rounded border border-border bg-card px-1.5 text-[11px] font-medium normal-case tracking-normal text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type PendingConfirm = "rerun" | "cancel" | null;

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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const [now, setNow] = useState(() => Date.now());
  const initializedFor = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const rerunButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  // Log ids and timeline node ids are scoped to a single run, so a leftover
  // selection or expansion would point at nodes that do not exist on the newly
  // selected run. Reset them when the run changes.
  useEffect(() => {
    setSelectedLogId(null);
    setExpanded(new Set());
    setConfirm(null);
    initializedFor.current = null;
  }, [buildId]);

  const appSettingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const readOnly = appSettingsQuery.data?.readOnlyValidationModeEnabled ?? false;

  const runQuery = useQuery({
    queryKey: ["pipelineRun", organizationId, projectId, buildId],
    queryFn: () => getPipelineRun({ organizationId, projectId, buildId: buildId as number }),
    enabled: buildId != null && !!projectId,
    refetchInterval: (query) => {
      const data = query.state.data as PipelineRunDetail | undefined;
      return data && isInProgressStatus(data.run.status) ? LOG_REFRESH_INTERVAL_MS : false;
    },
  });
  const detail = runQuery.data ?? null;
  const run = detail?.run ?? null;
  const inProgress = !!run && isInProgressStatus(run.status);

  const tree = useMemo(() => (detail ? buildTimelineTree(detail.timeline) : []), [detail]);
  const firstFailure = useMemo(() => findFirstFailure(tree), [tree]);

  // On first load of a run: fold the branches that succeeded and open the
  // first failed step's log, so a failure is one glance away.
  useEffect(() => {
    if (!detail || tree.length === 0 || initializedFor.current === buildId) return;
    initializedFor.current = buildId;
    setExpanded(defaultExpandedIds(tree));
    if (firstFailure?.logId != null) setSelectedLogId(firstFailure.logId);
  }, [detail, tree, buildId, firstFailure]);

  // A running build's duration ticks live; the clock only runs while it does.
  useEffect(() => {
    if (!inProgress) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [inProgress]);

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
    // While the run is in progress, keep pulling the log tail so an open job's
    // output follows live instead of freezing on the first fetch (issue #435).
    refetchInterval: () => (inProgress ? LOG_REFRESH_INTERVAL_MS : false),
  });

  const artifactsQuery = useQuery({
    queryKey: ["pipelineArtifacts", organizationId, projectId, buildId],
    queryFn: () => listPipelineArtifacts({ organizationId, projectId, buildId: buildId as number }),
    enabled: buildId != null && !!projectId,
    staleTime: 60_000,
  });
  const artifacts = artifactsQuery.data ?? [];

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
        queryKey: ["pipelineSubscriptionHistory", organizationId, projectId],
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
        queryKey: ["pipelineSubscriptionHistory", organizationId, projectId],
      });
    },
  });

  const canRerun = !!run && run.definitionId != null && run.sourceBranch != null;
  const canCancel = !!run && inProgress;

  function toggleNode(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function jumpToFirstFailure() {
    if (!firstFailure || firstFailure.logId == null) return;
    const logId = firstFailure.logId;
    setExpanded((prev) => new Set([...prev, ...ancestorIdsOfLog(tree, logId)]));
    setSelectedLogId(logId);
    window.setTimeout(() => {
      timelineRef.current?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]')?.focus();
    }, 30);
  }

  function askConfirm(kind: Exclude<PendingConfirm, null>) {
    if (kind === "rerun" ? !canRerun || readOnly || rerun.isPending : !canCancel || readOnly || cancel.isPending) {
      return;
    }
    setConfirm(kind);
  }

  function closeConfirm() {
    const target = confirm === "cancel" ? cancelButtonRef.current : rerunButtonRef.current;
    setConfirm(null);
    // Return focus to the button that opened the bar so keyboard use resumes there.
    window.setTimeout(() => (target?.isConnected ? target : null)?.focus(), 0);
  }

  function runConfirmed() {
    const kind = confirm;
    closeConfirm();
    if (kind === "rerun") rerun.mutate();
    else if (kind === "cancel") cancel.mutate();
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "f") {
      event.preventDefault();
      jumpToFirstFailure();
    } else if (key === "r") {
      event.preventDefault();
      askConfirm("rerun");
    } else if (key === "x") {
      event.preventDefault();
      askConfirm("cancel");
    }
  }

  const visual = run ? pipelineRunVisual(run.status, run.result) : null;
  const mutationError = rerun.error ?? cancel.error;
  const liveFinish = run?.finishTime ?? (inProgress && run?.startTime ? new Date(now).toISOString() : null);
  const selectedNode = selectedLogId != null ? findNodeByLogId(tree, selectedLogId) : null;
  const allExpanded = tree.length > 0 && [...allBranchIds(tree)].every((id) => expanded.has(id));

  return (
    <aside
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        data-primary-preview="true"
        aria-keyshortcuts="Control+P"
        tabIndex={-1}
      >
        {buildId == null ? (
          <PreviewEmptyState message="Select a run." hint={SELECT_EMPTY_HINT} />
        ) : runQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 px-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading run…
          </div>
        ) : runQuery.isError || !run || !visual ? (
          <div className="px-3 py-4 text-sm text-destructive">
            {commandErrorMessage(runQuery.error) || "Run unavailable."}
          </div>
        ) : (
          <div className="flex min-h-full flex-col">
            {/* In the dock tab strip when the host provides a slot; inline otherwise. */}
            <PreviewToolbarPortal>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openExternalUrl(run.webUrl)}
                  aria-label="Open in Azure DevOps"
                  title="Open in Azure DevOps"
                  className={`${TOOLBAR_BUTTON} text-primary`}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  ref={rerunButtonRef}
                  type="button"
                  onClick={() => askConfirm("rerun")}
                  disabled={!canRerun || readOnly || rerun.isPending}
                  aria-keyshortcuts="R"
                  aria-label="Re-run"
                  title={readOnly ? "Read-only validation mode is enabled" : "Re-run (R)"}
                  className={TOOLBAR_BUTTON}
                >
                  {rerun.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
                {canCancel ? (
                  <button
                    ref={cancelButtonRef}
                    type="button"
                    onClick={() => askConfirm("cancel")}
                    disabled={readOnly || cancel.isPending}
                    aria-keyshortcuts="X"
                    aria-label="Cancel run"
                    title={readOnly ? "Read-only validation mode is enabled" : "Cancel run (X)"}
                    className={TOOLBAR_BUTTON}
                  >
                    {cancel.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                ) : null}
              </div>
            </PreviewToolbarPortal>

            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <RunBadge visual={visual} />
                <span className="truncate font-semibold" title={run.definitionName ?? undefined}>
                  {run.definitionName ?? "Pipeline"}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {run.buildNumber ?? run.buildId}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                <span className="font-medium text-foreground" title={run.sourceBranch ?? undefined}>
                  {shortBranch(run.sourceBranch)}
                </span>
                {run.reason ? ` · ${run.reason}` : ""}
                {run.requestedFor ? ` · ${run.requestedFor}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {run.queueTime ? (
                  <span title={formatDate(run.queueTime)}>Queued {formatRelativeDate(run.queueTime)}</span>
                ) : (
                  "Queued —"
                )}
                {" · Duration "}
                <span className="text-foreground">{formatDuration(run.startTime, liveFinish)}</span>
              </p>
              {mutationError ? (
                <p role="alert" className="mt-2 flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {commandErrorMessage(mutationError)}
                </p>
              ) : null}
            </div>

            {confirm ? (
              <PipelineConfirmBar
                message={
                  confirm === "rerun"
                    ? `Queue a new run of ${run.definitionName ?? "this pipeline"} on ${shortBranch(run.sourceBranch)}?`
                    : "Cancel this run?"
                }
                confirmLabel={confirm === "rerun" ? "Re-run" : "Cancel run"}
                cancelLabel={confirm === "rerun" ? "Cancel" : "Keep running"}
                onConfirm={runConfirmed}
                onCancel={closeConfirm}
              />
            ) : null}

            <PreviewBand
              action={
                tree.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpanded(allExpanded ? new Set() : allBranchIds(tree))}
                      className={BAND_BUTTON}
                    >
                      {allExpanded ? "Collapse all" : "Expand all"}
                    </button>
                    <button
                      type="button"
                      onClick={jumpToFirstFailure}
                      disabled={!firstFailure}
                      aria-keyshortcuts="F"
                      title={firstFailure ? "Jump to the first failed step (F)" : "No failed step"}
                      className={BAND_BUTTON}
                    >
                      First failure
                    </button>
                  </span>
                ) : undefined
              }
            >
              Timeline
            </PreviewBand>
            <div ref={timelineRef} className="border-b border-border">
              {tree.length === 0 ? (
                detail?.timelineUnavailable ? (
                  <p className="px-3 py-3 text-xs text-amber-700 dark:text-amber-400">
                    Failed to load the timeline. It may be a transient error — try refreshing.
                  </p>
                ) : (
                  <p className="px-3 py-3 text-xs text-muted-foreground">No timeline available.</p>
                )
              ) : (
                <PipelineTimeline
                  tree={tree}
                  expanded={expanded}
                  onToggle={toggleNode}
                  selectedLogId={selectedLogId}
                  onSelectLog={setSelectedLogId}
                />
              )}
            </div>

            {artifacts.length > 0 ? (
              <div className="border-b border-border pb-2">
                <PreviewBand>Artifacts ({artifacts.length})</PreviewBand>
                <ul className="flex flex-col gap-1 px-3">
                  {artifacts.map((artifact) => (
                    <li key={artifact.name} className="flex items-center gap-2">
                      <span className="truncate text-xs text-foreground" title={artifact.name}>
                        {artifact.name}
                      </span>
                      {artifact.downloadUrl ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (artifact.downloadUrl) openExternalUrl(artifact.downloadUrl);
                          }}
                          title={`Download ${artifact.name}`}
                          aria-label={`Download artifact ${artifact.name}`}
                          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-1.5 py-px text-[11px] text-primary hover:bg-secondary"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden="true" /> Download
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!inProgress && !readOnly ? (
              <PipelineStageRetryPanel
                organizationId={organizationId}
                projectId={projectId}
                buildId={buildId}
                tree={tree}
              />
            ) : null}

            <PipelineTestResultsPanel
              organizationId={organizationId}
              projectId={projectId}
              buildId={buildId}
            />

            {selectedLogId == null ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Select a stage or job to view its log tail.
              </p>
            ) : logQuery.isLoading ? (
              <div className="pb-2">
                <PreviewBand>Log</PreviewBand>
                <p className="px-3 text-xs text-muted-foreground">Loading log…</p>
              </div>
            ) : logQuery.isError ? (
              <div className="pb-2">
                <PreviewBand>Log</PreviewBand>
                <p className="px-3 text-xs text-destructive">
                  {commandErrorMessage(logQuery.error) || "Log unavailable."}
                </p>
              </div>
            ) : (
              <PipelineLogViewer
                key={selectedLogId}
                title={selectedNode?.name ?? "Log"}
                lines={logQuery.data?.lines ?? NO_LINES}
                truncated={logQuery.data?.truncated ?? false}
                webUrl={run.webUrl}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
