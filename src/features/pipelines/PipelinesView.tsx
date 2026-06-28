import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus } from "lucide-react";
import {
  commandErrorMessage,
  listPipelineApprovals,
  listPipelineDefinitions,
  listPipelineProjects,
  queuePipelineRun,
  updatePipelineApproval,
  type Organization,
} from "@/lib/azdoCommands";
import { ResizeHandle } from "@/components/ResizeHandle";
import { storedNumber } from "@/lib/utils";
import { FilterableSelect } from "./FilterableSelect";
import { PipelineApprovalsPanel } from "./PipelineApprovalsPanel";
import { PipelineDefinitionPanel } from "./PipelineDefinitionPanel";
import { PipelineRunDetailPanel } from "./PipelineRunDetailPanel";
import { PipelineSubscriptionsBoard } from "./PipelineSubscriptionsBoard";
import {
  addSubscription,
  isSubscribed,
  loadPipelineSubscriptions,
  MAX_SUBSCRIPTIONS,
  type PipelineSubscription,
  removeSubscription,
  savePipelineSubscriptions,
} from "./pipelineSubscriptionsStorage";

const DEFAULT_PIPELINE_PREVIEW_WIDTH = 460;
const MIN_PIPELINE_PREVIEW_WIDTH = 320;
const MAX_PIPELINE_PREVIEW_WIDTH = 8192;
const PIPELINE_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:pipelinePreviewWidth";

export function PipelinesView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(() => organizations[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [definitionId, setDefinitionId] = useState<number | null>(null);
  // Run shown in the detail panel, chosen from a watched pipeline's history
  // (possibly in another project).
  const [detailTarget, setDetailTarget] = useState<{
    organizationId: string;
    projectId: string;
    definitionId: number;
    buildId: number;
  } | null>(null);
  const [subscriptions, setSubscriptions] = useState<PipelineSubscription[]>(() =>
    loadPipelineSubscriptions(),
  );
  const [watchToast, setWatchToast] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      PIPELINE_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_PIPELINE_PREVIEW_WIDTH,
      MIN_PIPELINE_PREVIEW_WIDTH,
      MAX_PIPELINE_PREVIEW_WIDTH,
    ),
  );

  useEffect(() => {
    window.localStorage.setItem(
      PIPELINE_PREVIEW_WIDTH_STORAGE_KEY,
      String(Math.round(previewWidth)),
    );
  }, [previewWidth]);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  useEffect(() => {
    if (!organizationId && organizations[0]) setOrganizationId(organizations[0].id);
  }, [organizationId, organizations]);

  const projectsQuery = useQuery({
    queryKey: ["pipelineProjects", selectedOrganizationId],
    queryFn: () => listPipelineProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const projectOptions = projectsQuery.data ?? [];

  // Auto-select the first project so the view loads runs without manual setup.
  useEffect(() => {
    if (!projectId && projectOptions.length > 0) {
      setProjectId(projectOptions[0].id);
    }
  }, [projectId, projectOptions]);

  const definitionsQuery = useQuery({
    queryKey: ["pipelineDefinitions", selectedOrganizationId, projectId],
    queryFn: () => listPipelineDefinitions({ organizationId: selectedOrganizationId, projectId }),
    enabled: !!selectedOrganizationId && !!projectId,
    staleTime: 5 * 60_000,
  });
  const definitionOptions = definitionsQuery.data ?? [];

  const queryClient = useQueryClient();
  const approvalsQuery = useQuery({
    queryKey: ["pipelineApprovals", selectedOrganizationId, projectId],
    queryFn: () =>
      listPipelineApprovals({ organizationId: selectedOrganizationId, projectId }),
    enabled: !!selectedOrganizationId && !!projectId,
    staleTime: 30_000,
  });
  const approvalMutation = useMutation({
    mutationFn: updatePipelineApproval,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["pipelineApprovals", selectedOrganizationId, projectId],
      });
    },
  });
  const pendingApprovalId = approvalMutation.isPending
    ? (approvalMutation.variables?.approvalId ?? null)
    : null;

  const selectedProject = projectOptions.find((project) => project.id === projectId);
  const selectedDefinition =
    definitionId != null
      ? definitionOptions.find((definition) => definition.id === definitionId)
      : undefined;
  const projectSelectOptions = useMemo(
    () => projectOptions.map((project) => ({ value: project.id, label: project.name })),
    [projectOptions],
  );
  const definitionSelectOptions = useMemo(
    () => [
      { value: "", label: "All pipelines" },
      ...definitionOptions.map((definition) => ({
        value: String(definition.id),
        label: definition.name,
      })),
    ],
    [definitionOptions],
  );

  const canSubscribe = definitionId != null && !!selectedProject && !!selectedDefinition;
  const selectedIsSubscribed =
    definitionId != null &&
    isSubscribed(subscriptions, selectedOrganizationId, projectId, definitionId);

  function persistSubscriptions(next: PipelineSubscription[]) {
    setSubscriptions(next);
    savePipelineSubscriptions(next);
  }

  function handleSubscribe() {
    if (!canSubscribe || definitionId == null || !selectedProject || !selectedDefinition) return;
    if (selectedIsSubscribed) {
      persistSubscriptions(
        removeSubscription(subscriptions, selectedOrganizationId, projectId, definitionId),
      );
      return;
    }
    const result = addSubscription(subscriptions, {
      organizationId: selectedOrganizationId,
      projectId,
      projectName: selectedProject.name,
      definitionId,
      definitionName: selectedDefinition.name,
    });
    if (result.status === "limit") {
      setWatchToast(`Watch limit reached (${MAX_SUBSCRIPTIONS}). Remove one to add another.`);
      window.setTimeout(() => setWatchToast(null), 3000);
      return;
    }
    persistSubscriptions(result.subscriptions);
  }

  // Queue a new pipeline run (#397): pick the selected definition, a branch, and
  // optional runtime parameters.
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueBranch, setQueueBranch] = useState("main");
  const [queueParams, setQueueParams] = useState("");
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const canQueue = definitionId != null && !!selectedProject && !!selectedDefinition;
  const queueMutation = useMutation({
    mutationFn: queuePipelineRun,
    onSuccess: (run) => {
      setQueueError(null);
      setQueueOpen(false);
      setQueueNotice(`Queued ${selectedDefinition?.name ?? "pipeline"} #${run.buildId}.`);
      window.setTimeout(() => setQueueNotice(null), 4000);
      void queryClient.invalidateQueries({ queryKey: ["pipelineSubscriptionHistory"] });
    },
    onError: (error) => setQueueError(commandErrorMessage(error)),
  });

  function submitQueue() {
    if (!canQueue || definitionId == null) return;
    const branch = queueBranch.trim();
    if (!branch) {
      setQueueError("Enter a branch.");
      return;
    }
    const parameters: Record<string, string> = {};
    for (const line of queueParams.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) {
        setQueueError(`Parameters must be name=value (got "${trimmed}").`);
        return;
      }
      parameters[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    queueMutation.mutate({
      organizationId: selectedOrganizationId,
      projectId,
      definitionId,
      sourceBranch: branch,
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    });
  }

  const selectClasses =
    "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-card">
        <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-[200px_minmax(200px,1fr)_auto]">
          {organizations.length > 1 ? (
            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={selectedOrganizationId}
                onChange={(event) => {
                  setOrganizationId(event.target.value);
                  setProjectId("");
                  setDefinitionId(null);
                  setDetailTarget(null);
                }}
                className={selectClasses}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="grid gap-2">
            <span className="text-sm font-medium">Project</span>
            <FilterableSelect
              ariaLabel="Project"
              value={projectId}
              options={projectSelectOptions}
              disabled={projectsQuery.isLoading || projectOptions.length === 0}
              placeholder={projectOptions.length === 0 ? "No projects" : "Select a project"}
              onChange={(next) => {
                setProjectId(next);
                setDefinitionId(null);
              }}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Pipeline</span>
            <FilterableSelect
              ariaLabel="Pipeline"
              value={definitionId == null ? "" : String(definitionId)}
              options={definitionSelectOptions}
              disabled={definitionsQuery.isLoading || definitionOptions.length === 0}
              placeholder="All pipelines"
              onChange={(next) => setDefinitionId(next ? Number(next) : null)}
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={!canSubscribe}
              title={
                !canSubscribe
                  ? "Select a pipeline to watch its history"
                  : selectedIsSubscribed
                    ? "Remove this pipeline from the watch list"
                    : "Watch this pipeline's run history"
              }
              aria-pressed={selectedIsSubscribed}
              className={`flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                selectedIsSubscribed
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {selectedIsSubscribed ? "Watching" : "Watch"}
            </button>
            <button
              type="button"
              onClick={() => {
                setQueueError(null);
                setQueueOpen((open) => !open);
              }}
              disabled={!canQueue}
              aria-expanded={queueOpen}
              title={canQueue ? "Queue a new run of this pipeline" : "Select a pipeline to queue a run"}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Queue run
            </button>
          </div>
        </div>

        {queueOpen && canQueue ? (
          <div className="mt-3 grid gap-2 rounded-md border border-border bg-background p-3">
            <p className="text-sm font-medium">
              Queue {selectedDefinition?.name}
            </p>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Branch</span>
              <input
                value={queueBranch}
                onChange={(event) => setQueueBranch(event.target.value)}
                placeholder="main"
                aria-label="Branch"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Parameters (one name=value per line, optional)</span>
              <textarea
                value={queueParams}
                onChange={(event) => setQueueParams(event.target.value)}
                rows={3}
                placeholder={"environment=prod\nrunTests=true"}
                aria-label="Parameters"
                className="resize-y rounded-md border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={submitQueue}
                disabled={queueMutation.isPending || !queueBranch.trim()}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Queue
              </button>
              <button
                type="button"
                onClick={() => setQueueOpen(false)}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
            {queueError ? (
              <p role="alert" className="text-xs text-destructive">
                {queueError}
              </p>
            ) : null}
          </div>
        ) : null}
        {queueNotice ? (
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{queueNotice}</p>
        ) : null}
      </div>

      {projectId && (approvalsQuery.data?.length || approvalMutation.isError) ? (
        <PipelineApprovalsPanel
          approvals={approvalsQuery.data ?? []}
          pendingApprovalId={pendingApprovalId}
          error={
            approvalMutation.isError ? commandErrorMessage(approvalMutation.error) : null
          }
          onAct={(approvalId, status) =>
            approvalMutation.mutate({
              organizationId: selectedOrganizationId,
              projectId,
              approvalId,
              status,
            })
          }
        />
      ) : null}

      <div
        className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_8px_minmax(320px,var(--pipeline-preview-width))]"
        style={{ "--pipeline-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        <PipelineSubscriptionsBoard
          organizationId={selectedOrganizationId}
          subscriptions={subscriptions}
          selectedBuildId={detailTarget?.buildId ?? null}
          onSelectRun={(selection) => setDetailTarget(selection)}
          onRemove={(removeProjectId, removeDefinitionId) => {
            persistSubscriptions(
              removeSubscription(
                subscriptions,
                selectedOrganizationId,
                removeProjectId,
                removeDefinitionId,
              ),
            );
            // Clear the detail panel only if it is showing a run from the exact
            // pipeline that was just unwatched, identified by project and
            // definition (other pipelines in the same project stay shown).
            if (
              detailTarget?.projectId === removeProjectId &&
              detailTarget?.definitionId === removeDefinitionId
            ) {
              setDetailTarget(null);
            }
          }}
        />

        <ResizeHandle
          ariaLabel="Resize pipeline preview"
          className="hidden xl:flex"
          direction={-1}
          max={MAX_PIPELINE_PREVIEW_WIDTH}
          min={MIN_PIPELINE_PREVIEW_WIDTH}
          onChange={setPreviewWidth}
          onReset={() => setPreviewWidth(DEFAULT_PIPELINE_PREVIEW_WIDTH)}
          value={previewWidth}
        />

        {detailTarget == null && definitionId != null && selectedDefinition ? (
          <PipelineDefinitionPanel
            organizationId={selectedOrganizationId}
            projectId={projectId}
            definitionId={definitionId}
            definitionName={selectedDefinition.name}
          />
        ) : (
          <PipelineRunDetailPanel
            organizationId={detailTarget?.organizationId ?? selectedOrganizationId}
            projectId={detailTarget?.projectId ?? projectId}
            buildId={detailTarget?.buildId ?? null}
          />
        )}
      </div>

      {watchToast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg"
        >
          {watchToast}
        </div>
      )}
    </div>
  );
}
