import { z } from "zod";
import { invokeCommand } from "./runtime";
import type { AgentKind } from "./agentNotes";

// Auto queue lists review and investigation candidates for manual execution,
// independently of the automatic review setting.

export type AutoQueueTargetKind = "pull-request" | "work-item";

const autoQueueItemSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  target: z.enum(["pull-request", "work-item"]),
  id: z.number().int(),
  title: z.string(),
  scope: z.string(),
  scopeId: z.string().default(""),
  webUrl: z.string().nullable().default(null),
  createdDate: z.string().nullable().default(null),
});

export type AutoQueueItem = z.infer<typeof autoQueueItemSchema>;

const autoQueuePreviewSchema = z.object({
  document: z.string(),
  chars: z.number().int(),
  estimatedTokens: z.number().int(),
  unavailable: z.string().nullable().default(null),
});

export type AutoQueuePreview = z.infer<typeof autoQueuePreviewSchema>;

export type AutoQueueTarget = Pick<AutoQueueItem, "organizationId" | "target" | "id">;

export function autoQueueKey(item: AutoQueueTarget): string {
  return `${item.organizationId}:${item.target}:${item.id}`;
}

export async function listAutoQueue(): Promise<AutoQueueItem[]> {
  const result = await invokeCommand("list_auto_queue", {});
  return z.array(autoQueueItemSchema).parse(result);
}

/** The material the agent would get; fetched for one item at a time. */
export async function getAutoQueuePreview(input: AutoQueueTarget): Promise<AutoQueuePreview> {
  const result = await invokeCommand("get_auto_queue_preview", { input });
  return autoQueuePreviewSchema.parse(result);
}

/** Hands the picked items to the agent; resolves with how many were queued. `focus` is what the agent should look at first. */
export async function runAutoQueue(input: AutoQueueTarget[], focus?: string): Promise<number> {
  const result = await invokeCommand("run_auto_queue", { input, focus });
  return z.number().int().parse(result);
}

/** Investigates every unhandled work item assigned to me, three at a time; resolves with how many were queued. */
export async function runAssignedWorkItemInvestigations(agent?: AgentKind): Promise<number> {
  const result = await invokeCommand("run_assigned_work_item_investigations", { agent });
  return z.number().int().parse(result);
}

export type WorkItemInvestigationTarget = {
  organizationId: string;
  projectId: string;
  projectName: string;
  id: number;
  title: string;
};

/** Investigates the work items picked in a view, three at a time; resolves with how many were queued. */
export async function runWorkItemInvestigations(input: WorkItemInvestigationTarget[], agent?: AgentKind): Promise<number> {
  const result = await invokeCommand("run_work_item_investigations", { input, agent });
  return z.number().int().parse(result);
}
