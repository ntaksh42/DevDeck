import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commandErrorMessage,
  getPipelineDefinition,
  listRepoBranches,
  type PipelineVariable,
  queuePipelineRun,
} from "@/lib/azdoCommands";

// The Queue run branch picker (and its free-text fallback) works with short
// branch names, e.g. "main", but the build API's sourceBranch requires the
// full ref, e.g. "refs/heads/main" (see queue_build in azdo-client).
export function toSourceBranchRef(branch: string): string {
  return branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
}

// Secret variables never carry their current value to the client, so their
// input starts empty rather than pre-filled.
function queueParamDefault(variable: PipelineVariable): string {
  return variable.isSecret ? "" : (variable.value ?? "");
}

interface UseQueueRunFormParams {
  organizationId: string;
  projectId: string;
  definitionId: number | null;
  canQueue: boolean;
  definitionName: string | undefined;
}

// Queue a new pipeline run (#397): pick the selected definition, a branch, and
// optional runtime parameters.
export function useQueueRunForm({
  organizationId,
  projectId,
  definitionId,
  canQueue,
  definitionName,
}: UseQueueRunFormParams) {
  const queryClient = useQueryClient();
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueBranch, setQueueBranch] = useState("main");
  const [queueParams, setQueueParams] = useState("");
  const [queueParamValues, setQueueParamValues] = useState<Record<string, string>>({});
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);

  // The definition detail (same query PipelineDefinitionPanel uses, so the
  // cache is shared) carries the repository the pipeline builds from. Only a
  // TfsGit repository with a known id can back a branch picker.
  const queueDefinitionDetailQuery = useQuery({
    queryKey: ["pipelineDefinition", organizationId, projectId, definitionId],
    queryFn: () =>
      getPipelineDefinition({
        organizationId,
        projectId,
        definitionId: definitionId as number,
      }),
    enabled: queueOpen && canQueue && definitionId != null,
    staleTime: 5 * 60_000,
  });
  const queueRepository = queueDefinitionDetailQuery.data?.repository ?? null;
  const canPickQueueBranch =
    !!queueRepository && queueRepository.type === "TfsGit" && !!queueRepository.id;

  // Variables the definition allows overriding at queue time get their own
  // labeled input; everything else keeps using the free-text textarea below.
  const overridableVariables = useMemo(
    () => (queueDefinitionDetailQuery.data?.variables ?? []).filter((v) => v.allowOverride),
    [queueDefinitionDetailQuery.data],
  );

  // Reset entered values to each variable's default when the set of
  // overridable variables changes (a different definition was selected, or
  // its detail just loaded).
  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const variable of overridableVariables) {
      defaults[variable.name] = queueParamDefault(variable);
    }
    setQueueParamValues(defaults);
  }, [overridableVariables]);

  const queueBranchesQuery = useQuery({
    queryKey: ["pipelineQueueBranches", organizationId, projectId, queueRepository?.id],
    queryFn: () =>
      listRepoBranches({
        organizationId,
        project: projectId,
        repository: queueRepository!.id,
      }),
    enabled: queueOpen && canPickQueueBranch,
    staleTime: 5 * 60_000,
  });
  const queueBranchOptions = useMemo(
    () =>
      (queueBranchesQuery.data ?? []).map((branch) => ({
        value: branch.name,
        label: branch.isDefault ? `${branch.name} (default)` : branch.name,
      })),
    [queueBranchesQuery.data],
  );
  // Fall back to free-text entry when there's no repository, it isn't
  // TfsGit, or the branch list failed to load.
  const showQueueBranchSelect = canPickQueueBranch && !queueBranchesQuery.isError;

  // Default the branch to the repository's default branch once it loads.
  useEffect(() => {
    if (!queueOpen || !canPickQueueBranch) return;
    const defaultBranch = queueBranchesQuery.data?.find((branch) => branch.isDefault)?.name;
    if (defaultBranch) setQueueBranch(defaultBranch);
  }, [queueOpen, canPickQueueBranch, queueBranchesQuery.data]);

  const queueMutation = useMutation({
    mutationFn: queuePipelineRun,
    onSuccess: (run) => {
      setQueueError(null);
      setQueueOpen(false);
      setQueueNotice(`Queued ${definitionName ?? "pipeline"} #${run.buildId}.`);
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
    // Item inputs win over a same-named textarea entry, and only variables
    // actually changed from their default are sent.
    for (const variable of overridableVariables) {
      const current = queueParamValues[variable.name];
      if (current === undefined || current === queueParamDefault(variable)) continue;
      parameters[variable.name] = current;
    }
    queueMutation.mutate({
      organizationId,
      projectId,
      definitionId,
      sourceBranch: toSourceBranchRef(branch),
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    });
  }

  return {
    queueOpen,
    setQueueOpen,
    queueBranch,
    setQueueBranch,
    queueParams,
    setQueueParams,
    queueParamValues,
    setQueueParamValues,
    queueError,
    setQueueError,
    queueNotice,
    showQueueBranchSelect,
    queueBranchOptions,
    queueBranchesQuery,
    overridableVariables,
    queueMutation,
    submitQueue,
  };
}
