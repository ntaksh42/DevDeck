import { z } from "zod";
import { invokeCommand } from "./runtime";

// Agent Work: what the automatic reviewer / investigator did and is doing,
// read from its durable history, plus the items excluded from automatic runs.

const agentWorkEntrySchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  target: z.enum(["pull-request", "work-item"]),
  id: z.number().int(),
  scopeId: z.string(),
  title: z.string(),
  scope: z.string(),
  projectId: z.string().nullable().default(null),
  webUrl: z.string().nullable().default(null),
  status: z.enum(["waiting", "running", "failed", "partial", "succeeded", "none"]),
  excluded: z.boolean(),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  failures: z.number().int(),
  nextRetryAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  exitCode: z.number().int().nullable().default(null),
  hasLog: z.boolean(),
});

export type AgentWorkEntry = z.infer<typeof agentWorkEntrySchema>;
export type AgentWorkStatus = AgentWorkEntry["status"];
export type AgentWorkTarget = Pick<AgentWorkEntry, "organizationId" | "target" | "id" | "scopeId">;

export function agentWorkKey(item: Pick<AgentWorkEntry, "organizationId" | "target" | "id">): string {
  return `${item.organizationId}:${item.target}:${item.id}`;
}

function targetOf(entry: AgentWorkTarget): AgentWorkTarget {
  return { organizationId: entry.organizationId, target: entry.target, id: entry.id, scopeId: entry.scopeId };
}

export async function listAgentWork(): Promise<AgentWorkEntry[]> {
  const result = await invokeCommand("list_agent_work", {});
  return z.array(agentWorkEntrySchema).parse(result);
}

/** The end of the latest attempt's agent log. */
export async function readAgentWorkLog(entry: AgentWorkTarget): Promise<string> {
  const result = await invokeCommand("read_agent_work_log", { input: targetOf(entry) });
  return z.string().parse(result);
}

/** Starts a failed item again now, skipping its retry delay. */
export async function retryAgentWork(entry: AgentWorkTarget): Promise<void> {
  await invokeCommand("retry_agent_work", { input: targetOf(entry) });
}

export type AgentWorkExclusion = AgentWorkTarget & { title: string; scope: string };

/** Excludes an item from automatic runs, or includes it again. */
export async function setAgentWorkExcluded(item: AgentWorkExclusion, excluded: boolean): Promise<void> {
  const { organizationId, target, id, scopeId, title, scope } = item;
  await invokeCommand("set_agent_work_excluded", {
    input: { organizationId, target, id, scopeId, title, scope, excluded },
  });
}
