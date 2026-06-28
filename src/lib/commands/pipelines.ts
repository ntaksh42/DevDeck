import { z } from "zod";
import { invokeCommand } from "./runtime";

const pipelineProjectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
const pipelineProjectOptionsSchema = z.array(pipelineProjectOptionSchema);
export type PipelineProjectOption = z.infer<typeof pipelineProjectOptionSchema>;

const pipelineDefinitionOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
});
const pipelineDefinitionOptionsSchema = z.array(pipelineDefinitionOptionSchema);
export type PipelineDefinitionOption = z.infer<typeof pipelineDefinitionOptionSchema>;

const pipelineRunSummarySchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  buildId: z.number(),
  buildNumber: z.string().nullable(),
  definitionId: z.number().nullable(),
  definitionName: z.string().nullable(),
  status: z.string().nullable(),
  result: z.string().nullable(),
  sourceBranch: z.string().nullable(),
  reason: z.string().nullable(),
  requestedFor: z.string().nullable(),
  queueTime: z.string().nullable(),
  startTime: z.string().nullable(),
  finishTime: z.string().nullable(),
  webUrl: z.string(),
});
const pipelineRunSummariesSchema = z.array(pipelineRunSummarySchema);
export type PipelineRunSummary = z.infer<typeof pipelineRunSummarySchema>;

const pipelineApprovalSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  instructions: z.string().nullable(),
  minRequiredApprovers: z.number(),
  executionOrder: z.string().nullable(),
  createdOn: z.string().nullable(),
  assignedApprovers: z.array(z.string()),
});
const pipelineApprovalSummariesSchema = z.array(pipelineApprovalSummarySchema);
export type PipelineApprovalSummary = z.infer<typeof pipelineApprovalSummarySchema>;

const timelineNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  nodeType: z.string().nullable(),
  name: z.string().nullable(),
  state: z.string().nullable(),
  result: z.string().nullable(),
  startTime: z.string().nullable(),
  finishTime: z.string().nullable(),
  logId: z.number().nullable(),
  errorCount: z.number(),
  warningCount: z.number(),
  order: z.number().nullable(),
});
export type TimelineNode = z.infer<typeof timelineNodeSchema>;

const pipelineRunDetailSchema = z.object({
  run: pipelineRunSummarySchema,
  timeline: z.array(timelineNodeSchema),
  timelineUnavailable: z.boolean().default(false),
});
export type PipelineRunDetail = z.infer<typeof pipelineRunDetailSchema>;

const pipelineLogTailSchema = z.object({
  lines: z.array(z.string()),
  truncated: z.boolean(),
});
export type PipelineLogTail = z.infer<typeof pipelineLogTailSchema>;

const pipelineTriggerSchema = z.object({
  triggerType: z.string().nullable(),
  branchFilters: z.array(z.string()),
  pathFilters: z.array(z.string()),
});
export type PipelineTrigger = z.infer<typeof pipelineTriggerSchema>;

const pipelineVariableSchema = z.object({
  name: z.string(),
  value: z.string().nullable(),
  isSecret: z.boolean(),
  allowOverride: z.boolean(),
});
export type PipelineVariable = z.infer<typeof pipelineVariableSchema>;

const pipelineDefinitionDetailSchema = z.object({
  definitionId: z.number(),
  name: z.string(),
  triggers: z.array(pipelineTriggerSchema),
  variables: z.array(pipelineVariableSchema),
});
export type PipelineDefinitionDetail = z.infer<typeof pipelineDefinitionDetailSchema>;

const pipelineArtifactSchema = z.object({
  name: z.string(),
  downloadUrl: z.string().nullable(),
});
const pipelineArtifactsSchema = z.array(pipelineArtifactSchema);
export type PipelineArtifact = z.infer<typeof pipelineArtifactSchema>;

export type ListPipelineRunsInput = {
  organizationId?: string;
  projectId: string;
  definitionId?: number;
  branch?: string;
  result?: string;
  status?: string;
  requestedForMe?: boolean;
};

export async function listPipelineProjects(input: {
  organizationId?: string;
}): Promise<PipelineProjectOption[]> {
  const result = await invokeCommand("list_pipeline_projects", { input });
  return pipelineProjectOptionsSchema.parse(result);
}

export async function listPipelineRuns(
  input: ListPipelineRunsInput,
): Promise<PipelineRunSummary[]> {
  const result = await invokeCommand("list_pipeline_runs", { input });
  return pipelineRunSummariesSchema.parse(result);
}

export async function listPipelineDefinitions(input: {
  organizationId?: string;
  projectId: string;
  nameFilter?: string;
}): Promise<PipelineDefinitionOption[]> {
  const result = await invokeCommand("list_pipeline_definitions", { input });
  return pipelineDefinitionOptionsSchema.parse(result);
}

export async function getPipelineRun(input: {
  organizationId?: string;
  projectId: string;
  buildId: number;
}): Promise<PipelineRunDetail> {
  const result = await invokeCommand("get_pipeline_run", { input });
  return pipelineRunDetailSchema.parse(result);
}

export async function listPipelineArtifacts(input: {
  organizationId?: string;
  projectId: string;
  buildId: number;
}): Promise<PipelineArtifact[]> {
  const result = await invokeCommand("list_pipeline_artifacts", { input });
  return pipelineArtifactsSchema.parse(result);
}

export async function getPipelineDefinition(input: {
  organizationId?: string;
  projectId: string;
  definitionId: number;
}): Promise<PipelineDefinitionDetail> {
  const result = await invokeCommand("get_pipeline_definition", { input });
  return pipelineDefinitionDetailSchema.parse(result);
}

export async function getPipelineRunLogTail(input: {
  organizationId?: string;
  projectId: string;
  buildId: number;
  logId: number;
  maxLines?: number;
}): Promise<PipelineLogTail> {
  const result = await invokeCommand("get_pipeline_run_log_tail", { input });
  return pipelineLogTailSchema.parse(result);
}

export async function rerunPipelineRun(input: {
  organizationId?: string;
  projectId: string;
  definitionId: number;
  sourceBranch: string;
}): Promise<PipelineRunSummary> {
  const result = await invokeCommand("rerun_pipeline_run", { input });
  return pipelineRunSummarySchema.parse(result);
}

export async function queuePipelineRun(input: {
  organizationId?: string;
  projectId: string;
  definitionId: number;
  sourceBranch: string;
  parameters?: Record<string, string>;
}): Promise<PipelineRunSummary> {
  const result = await invokeCommand("queue_pipeline_run", { input });
  return pipelineRunSummarySchema.parse(result);
}

export async function cancelPipelineRun(input: {
  organizationId?: string;
  projectId: string;
  buildId: number;
}): Promise<PipelineRunSummary> {
  const result = await invokeCommand("cancel_pipeline_run", { input });
  return pipelineRunSummarySchema.parse(result);
}

export async function listPipelineApprovals(input: {
  organizationId?: string;
  projectId: string;
}): Promise<PipelineApprovalSummary[]> {
  const result = await invokeCommand("list_pipeline_approvals", { input });
  return pipelineApprovalSummariesSchema.parse(result);
}

export async function updatePipelineApproval(input: {
  organizationId?: string;
  projectId: string;
  approvalId: string;
  status: "approved" | "rejected";
  comment?: string;
}): Promise<PipelineApprovalSummary[]> {
  const result = await invokeCommand("update_pipeline_approval", { input });
  return pipelineApprovalSummariesSchema.parse(result);
}
