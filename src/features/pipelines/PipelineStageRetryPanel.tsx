import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { commandErrorMessage, retryPipelineStage } from "@/lib/azdoCommands";
import { PreviewBand } from "@/components/PreviewBand";
import { PipelineConfirmBar } from "./PipelineConfirmBar";
import { type TreeNode } from "./pipelineTimelineTree";

type RetryTarget = { identifier: string; name: string; all: boolean };

function failedStages(nodes: TreeNode[]): { identifier: string; name: string }[] {
  const found: { identifier: string; name: string }[] = [];
  const visit = (node: TreeNode) => {
    const result = (node.result ?? "").toLowerCase();
    if (
      node.nodeType?.toLowerCase() === "stage" &&
      node.identifier &&
      (result === "failed" || result === "canceled")
    ) {
      found.push({ identifier: node.identifier, name: node.name ?? node.identifier });
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return found;
}

const BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-1.5 py-px text-[11px] text-primary hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// Re-runs one failed stage of a finished run instead of queueing a whole new
// run: "Retry failed jobs" re-runs only what failed, "Retry all jobs" the whole
// stage. Hidden when no stage failed. Each action asks for inline confirmation
// and hands focus back to its button afterwards.
export function PipelineStageRetryPanel({
  organizationId,
  projectId,
  buildId,
  tree,
}: {
  organizationId: string;
  projectId: string;
  buildId: number | null;
  tree: TreeNode[];
}) {
  const queryClient = useQueryClient();
  const stages = useMemo(() => failedStages(tree), [tree]);
  const [pending, setPending] = useState<RetryTarget | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const retry = useMutation({
    mutationFn: (target: RetryTarget) =>
      retryPipelineStage({
        organizationId,
        projectId,
        buildId: buildId as number,
        stageIdentifier: target.identifier,
        forceRetryAllJobs: target.all,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["pipelineRun", organizationId, projectId, buildId],
      });
    },
  });

  if (buildId == null || stages.length === 0) return null;

  function close() {
    const key = pending ? `${pending.identifier}:${pending.all}` : null;
    setPending(null);
    window.setTimeout(() => (key ? buttonRefs.current.get(key) : null)?.focus(), 0);
  }

  function confirmed() {
    const target = pending;
    close();
    if (target) retry.mutate(target);
  }

  return (
    <div className="border-b border-border pb-2">
      <PreviewBand>Failed stages ({stages.length})</PreviewBand>
      <ul className="flex flex-col gap-1 px-3">
        {stages.map((stage) => (
          <li key={stage.identifier} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={stage.name}>
              {stage.name}
            </span>
            {[false, true].map((all) => (
              <button
                key={String(all)}
                type="button"
                ref={(element) => {
                  const key = `${stage.identifier}:${all}`;
                  if (element) buttonRefs.current.set(key, element);
                  else buttonRefs.current.delete(key);
                }}
                disabled={retry.isPending}
                onClick={() => setPending({ identifier: stage.identifier, name: stage.name, all })}
                title={
                  all
                    ? `Re-run every job of ${stage.name} in this run`
                    : `Re-run only the failed jobs of ${stage.name} in this run`
                }
                className={BUTTON}
              >
                {retry.isPending && retry.variables?.identifier === stage.identifier ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                )}
                {all ? "Retry all jobs" : "Retry failed jobs"}
              </button>
            ))}
          </li>
        ))}
      </ul>
      {pending ? (
        <PipelineConfirmBar
          message={`Retry ${pending.all ? "all jobs" : "the failed jobs"} of stage ${pending.name} in this run?`}
          confirmLabel="Retry"
          cancelLabel="Cancel"
          onConfirm={confirmed}
          onCancel={close}
        />
      ) : null}
      {retry.isError ? (
        <p role="alert" className="mt-1 flex items-center gap-1 px-3 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {commandErrorMessage(retry.error)}
        </p>
      ) : null}
    </div>
  );
}
