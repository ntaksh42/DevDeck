import { z } from "zod";
import { invokeCommand } from "./runtime";

// Auto queue: the pull requests awaiting my review and the work items assigned
// to me that the automatic run would hand to the agent, listed so that only
// the ones I pick are started (setting `autoAgentApprovalEnabled`).

export type AutoQueueTargetKind = "pull-request" | "work-item";

const autoQueueItemSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  target: z.enum(["pull-request", "work-item"]),
  id: z.number().int(),
  title: z.string(),
  scope: z.string(),
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

/** Hands the picked items to the agent; resolves with how many were queued. */
export async function runAutoQueue(input: AutoQueueTarget[]): Promise<number> {
  const result = await invokeCommand("run_auto_queue", { input });
  return z.number().int().parse(result);
}
