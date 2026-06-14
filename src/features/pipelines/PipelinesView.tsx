import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import {
  commandErrorMessage,
  listPipelineDefinitions,
  listPipelineProjects,
  listPipelineRuns,
  type Organization,
  type PipelineRunSummary,
} from "@/lib/azdoCommands";
import {
  focusPrimaryPreview,
  formatDate,
  formatRelativeDate,
  isEditableTarget,
} from "@/lib/utils";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import {
  formatDuration,
  isInProgressStatus,
  pipelineRunVisual,
  runToneClasses,
  shortBranch,
} from "./pipelineStatus";
import { PipelineRunDetailPanel } from "./PipelineRunDetailPanel";

const RUN_REFRESH_INTERVAL_MS = 15_000;

const RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any result" },
  { value: "failed", label: "Failed" },
  { value: "succeeded", label: "Succeeded" },
  { value: "partiallySucceeded", label: "Partial" },
  { value: "canceled", label: "Canceled" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "inProgress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

export function PipelinesView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(() => organizations[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [definitionId, setDefinitionId] = useState<number | null>(null);
  const [branch, setBranch] = useState("");
  const [result, setResult] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [requestedForMe, setRequestedForMe] = useState(false);
  const [selectedBuildId, setSelectedBuildId] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const selectedOrganization = organizations.find((org) => org.id === selectedOrganizationId);
  const canFilterMine = !!selectedOrganization?.authenticatedUserId;

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

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

  const runsQuery = useQuery({
    queryKey: [
      "pipelineRuns",
      selectedOrganizationId,
      projectId,
      definitionId,
      branch,
      result,
      statusFilter,
      requestedForMe,
    ],
    queryFn: () =>
      listPipelineRuns({
        organizationId: selectedOrganizationId,
        projectId,
        definitionId: definitionId ?? undefined,
        branch: branch.trim() || undefined,
        result: result || undefined,
        status: statusFilter || undefined,
        requestedForMe: requestedForMe || undefined,
      }),
    enabled: !!selectedOrganizationId && !!projectId,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const data = query.state.data as PipelineRunSummary[] | undefined;
      return data?.some((run) => isInProgressStatus(run.status)) ? RUN_REFRESH_INTERVAL_MS : false;
    },
  });
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);

  // Reset selection when the result set changes shape.
  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(runs.length - 1, 0)));
  }, [runs.length]);
  useEffect(() => {
    setSelectedBuildId(runs[selectedIndex]?.buildId ?? null);
  }, [runs, selectedIndex]);

  function moveSelection(delta: number) {
    setSelectedIndex((index) => {
      const next = Math.min(Math.max(index + delta, 0), Math.max(runs.length - 1, 0));
      rowRefs.current[next]?.focus({ preventScroll: false });
      return next;
    });
  }

  function handleGridKeyDown(event: ReactKeyboardEvent) {
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedIndex(0);
      rowRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const last = Math.max(runs.length - 1, 0);
      setSelectedIndex(last);
      rowRefs.current[last]?.focus();
    } else if (event.key === "Enter" || event.key === "ArrowRight") {
      event.preventDefault();
      focusPrimaryPreview();
    }
  }

  const selectClasses =
    "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-card">
        <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-[160px_180px_minmax(140px,1fr)_150px_150px_auto_auto]">
          {organizations.length > 1 ? (
            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={selectedOrganizationId}
                onChange={(event) => {
                  setOrganizationId(event.target.value);
                  setProjectId("");
                  setDefinitionId(null);
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
            <select
              value={projectId}
              disabled={projectsQuery.isLoading || projectOptions.length === 0}
              onChange={(event) => {
                setProjectId(event.target.value);
                setDefinitionId(null);
                setSelectedIndex(0);
              }}
              className={selectClasses}
            >
              {projectOptions.length === 0 ? <option value="">No projects</option> : null}
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Pipeline</span>
            <select
              value={definitionId ?? ""}
              disabled={definitionsQuery.isLoading || definitionOptions.length === 0}
              onChange={(event) =>
                setDefinitionId(event.target.value ? Number(event.target.value) : null)
              }
              className={selectClasses}
            >
              <option value="">All pipelines</option>
              {definitionOptions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Branch</span>
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Result</span>
            <select
              value={result}
              onChange={(event) => setResult(event.target.value)}
              className={selectClasses}
            >
              {RESULT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={selectClasses}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-3">
            <label
              className="flex h-9 items-center gap-2 text-sm"
              title={canFilterMine ? undefined : "This organization has no identified user"}
            >
              <input
                type="checkbox"
                checked={requestedForMe && canFilterMine}
                disabled={!canFilterMine}
                onChange={(event) => setRequestedForMe(event.target.checked)}
              />
              Mine only
            </label>
            <button
              type="button"
              onClick={() => void runsQuery.refetch()}
              disabled={!projectId || runsQuery.isFetching}
              title="Refresh runs"
              aria-label="Refresh runs"
              className="flex h-9 items-center rounded-md border border-border bg-card px-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${runsQuery.isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>

      {runsQuery.isError ? <ErrorState message={commandErrorMessage(runsQuery.error)} /> : null}

      <div
        className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]"
        style={{} as CSSProperties}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-base font-semibold">Runs</h2>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {runsQuery.isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              {!projectId
                ? "Select a project"
                : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {!projectId ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Select a project to load pipeline runs.
            </div>
          ) : runsQuery.isLoading ? (
            <LoadingState />
          ) : runs.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No runs matched.
            </div>
          ) : (
            <div
              role="grid"
              aria-label="Pipeline runs"
              data-primary-grid="true"
              tabIndex={-1}
              className="min-h-0 flex-1 overflow-auto outline-none"
              onKeyDown={handleGridKeyDown}
            >
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[96px_minmax(120px,1fr)_110px_minmax(120px,1fr)_110px_140px_120px_80px] items-center gap-2 border-b border-border bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Status</span>
                  <span>Pipeline</span>
                  <span>Build</span>
                  <span>Branch</span>
                  <span>Reason</span>
                  <span>Requested for</span>
                  <span>Queued</span>
                  <span>Duration</span>
                </div>
                {runs.map((run, index) => {
                  const visual = pipelineRunVisual(run.status, run.result);
                  const selected = index === selectedIndex;
                  return (
                    <div
                      key={run.buildId}
                      ref={(el) => {
                        rowRefs.current[index] = el;
                      }}
                      role="row"
                      tabIndex={selected ? 0 : -1}
                      aria-selected={selected}
                      onClick={() => setSelectedIndex(index)}
                      className={`grid h-[29px] cursor-pointer select-none grid-cols-[96px_minmax(120px,1fr)_110px_minmax(120px,1fr)_110px_140px_120px_80px] items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
                        selected ? "bg-secondary" : "hover:bg-muted/50"
                      }`}
                    >
                      <span
                        className={`inline-flex w-fit items-center rounded px-1.5 py-px text-xs font-medium ${runToneClasses(
                          visual.tone,
                        )}`}
                      >
                        {visual.label}
                      </span>
                      <span className="truncate" title={run.definitionName ?? undefined}>
                        {run.definitionName ?? "—"}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {run.buildNumber ?? run.buildId}
                      </span>
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={run.sourceBranch ?? undefined}
                      >
                        {shortBranch(run.sourceBranch)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {run.reason ?? "—"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {run.requestedFor ?? "—"}
                      </span>
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={run.queueTime ? formatDate(run.queueTime) : undefined}
                      >
                        {run.queueTime ? formatRelativeDate(run.queueTime) : "—"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatDuration(run.startTime, run.finishTime)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <PipelineRunDetailPanel
          organizationId={selectedOrganizationId}
          projectId={projectId}
          buildId={selectedBuildId}
        />
      </div>
    </div>
  );
}
