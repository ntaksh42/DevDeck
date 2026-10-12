import { listMarkdown, type AgentListScope } from "@/components/agent/agentListScope";
import type { AgentSubject } from "@/components/agent/agentSubject";
import type { PipelineApprovalSummary, PipelineRunSummary } from "@/lib/azdoCommands";

/** A pipeline run as the Agent panel's subject (the material adds the timeline and failed logs). */
export function pipelineRunSubject(
  run: PipelineRunSummary,
  organizationId: string | undefined,
  projectId: string,
): AgentSubject {
  return {
    kind: "pipeline-run",
    id: run.buildId,
    title: `${run.buildNumber ?? run.buildId} (${run.definitionName ?? "pipeline"}${run.result ? `, ${run.result}` : ""})`,
    organizationId,
    projectId,
    webUrl: run.webUrl,
  };
}

/** The approvals waiting in the selected project, as an optional "Pending approvals" context. */
export function approvalsAgentList(approvals: readonly PipelineApprovalSummary[], projectName: string | undefined): AgentListScope {
  return {
    id: `pipeline-approvals:${projectName ?? ""}`,
    label: "Pending approvals",
    count: approvals.length,
    markdown: () =>
      listMarkdown({
        title: `Pending pipeline approvals${projectName ? ` in ${projectName}` : ""}`,
        headers: ["Status", "Instructions", "Approvers", "Min approvers", "Created"],
        rows: approvals.map((approval) => [
          approval.status,
          approval.instructions,
          approval.assignedApprovers.join(", "),
          approval.minRequiredApprovers,
          approval.createdOn?.slice(0, 10),
        ]),
      }),
  };
}
