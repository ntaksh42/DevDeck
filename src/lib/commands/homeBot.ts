import { z } from "zod";
import { invokeCommand } from "./runtime";
import type { AgentKind } from "./agentNotes";

// Home: Look around suggestions and the Orchestrator chat (src-tauri/src/home_bot).

export const HOME_EVERY_CHOICES = ["every-4h", "every-2h", "twice-daily", "mornings"] as const;
export type HomeEvery = (typeof HOME_EVERY_CHOICES)[number];

export const HOME_EVERY_LABELS: Record<HomeEvery, string> = {
  "every-4h": "Every 4 hours, 8:00 to 20:00",
  "every-2h": "Every 2 hours, 8:00 to 20:00",
  "twice-daily": "Twice a day, 8:00 and 13:00",
  mornings: "Each morning at 8:00",
};

const homeBotSettingsSchema = z.object({
  enabled: z.boolean(),
  every: z.enum(HOME_EVERY_CHOICES).catch("twice-daily"),
  weekdaysOnly: z.boolean(),
  focus: z.string(),
  agent: z.enum(["claude", "codex"]).catch("claude"),
  model: z.string(),
});
export type HomeBotSettings = z.infer<typeof homeBotSettingsSchema>;

const homeSuggestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  ask: z.string(),
  target: z.string().nullable(),
  targetLabel: z.string().nullable(),
  webUrl: z.string().nullable(),
  /** `pr` / `wi` / `pipe` / `other`. */
  kind: z.string(),
  /** `now` / `today` / `later`; the list arrives ordered by it. */
  urgency: z.string(),
  isNew: z.boolean(),
  createdAt: z.string(),
});
export type HomeSuggestion = z.infer<typeof homeSuggestionSchema>;

const homeBotViewSchema = z.object({
  settings: homeBotSettingsSchema,
  look: z.object({
    running: z.boolean(),
    lastLookedAt: z.string().nullable(),
    tookMs: z.number().nullable(),
    nextAt: z.string().nullable(),
    error: z.string().nullable(),
    failuresInARow: z.number(),
  }),
  brief: z.array(z.string()),
  suggestions: z.array(homeSuggestionSchema),
  newCount: z.number(),
});
export type HomeBotView = z.infer<typeof homeBotViewSchema>;

export const HOME_WORKER_STATUSES = ["queued", "running", "needs_you", "done", "failed", "stopped"] as const;
export type HomeWorkerStatus = (typeof HOME_WORKER_STATUSES)[number];

const homeWorkerSchema = z.object({
  id: z.string(),
  targetLabel: z.string(),
  title: z.string(),
  agent: z.string(),
  model: z.string().nullable(),
  status: z.enum(HOME_WORKER_STATUSES).catch("failed"),
  askId: z.number(),
  noteTarget: z.enum(["ask", "pull-request", "work-item"]).catch("ask"),
  subject: z
    .object({
      kind: z.enum(["pull-request", "work-item"]),
      id: z.number(),
      title: z.string(),
      organizationId: z.string(),
      projectId: z.string(),
      repositoryId: z.string().nullable(),
      repositoryName: z.string().nullable(),
      webUrl: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type HomeWorker = z.infer<typeof homeWorkerSchema>;

const homeChatMessageSchema = z.object({
  id: z.number(),
  author: z.string(),
  body: z.string(),
  workerIds: z.array(z.string()),
  createdAt: z.string(),
});
export type HomeChatMessage = z.infer<typeof homeChatMessageSchema>;

const homeChatViewSchema = z.object({
  chatId: z.string(),
  messages: z.array(homeChatMessageSchema),
  workers: z.array(homeWorkerSchema),
  state: z.enum(["idle", "thinking", "waiting"]).catch("idle"),
  waitingOn: z.number(),
  error: z.string().nullable(),
});
export type HomeChatView = z.infer<typeof homeChatViewSchema>;

export const homeBotKey = ["homeBot"] as const;
export const homeChatKey = ["homeChat"] as const;

export async function getHomeBot(): Promise<HomeBotView> {
  return homeBotViewSchema.parse(await invokeCommand("get_home_bot", {}));
}

export async function runHomeLookNow(): Promise<void> {
  await invokeCommand("run_home_look_now", {});
}

export async function markHomeSeen(): Promise<void> {
  await invokeCommand("mark_home_seen", {});
}

export async function dismissHomeSuggestion(id: string): Promise<void> {
  await invokeCommand("dismiss_home_suggestion", { input: { id } });
}

const suggestionAskSchema = z.object({
  ask: z.string(),
  target: z.string().nullable(),
  targetLabel: z.string().nullable(),
});

export async function startHomeSuggestion(id: string): Promise<z.infer<typeof suggestionAskSchema>> {
  return suggestionAskSchema.parse(await invokeCommand("start_home_suggestion", { input: { id } }));
}

export async function saveHomeBotSettings(input: HomeBotSettings): Promise<HomeBotSettings> {
  return homeBotSettingsSchema.parse(await invokeCommand("save_home_bot_settings", { input }));
}

/** A pipeline the Pipelines view watches; Look around reads its latest run. */
export type HomeWatchedPipeline = {
  organizationId: string;
  projectId: string;
  projectName: string;
  definitionId: number;
  definitionName: string;
};

/** Copies the Pipelines view's watch list to the backend for Look around. */
export async function saveHomePipelines(pipelines: HomeWatchedPipeline[]): Promise<void> {
  await invokeCommand("save_home_pipelines", { input: { pipelines } });
}

export async function clearHomeDismissed(): Promise<void> {
  await invokeCommand("clear_home_dismissed", {});
}

export async function countHomeDismissed(): Promise<number> {
  return z.number().parse(await invokeCommand("count_home_dismissed", {}));
}

export async function getHomeChat(): Promise<HomeChatView> {
  return homeChatViewSchema.parse(await invokeCommand("get_home_chat", {}));
}

export type SendHomeMessageInput = {
  text: string;
  target?: string | null;
  suggestionId?: string | null;
  agent?: AgentKind;
  /** "" leaves the model to the agent's own setting. */
  model?: string;
};

export async function sendHomeMessage(input: SendHomeMessageInput): Promise<void> {
  await invokeCommand("send_home_message", { input });
}

export async function newHomeChat(): Promise<string> {
  return z.string().parse(await invokeCommand("new_home_chat", {}));
}

export async function stopHomeWorker(id: string): Promise<void> {
  await invokeCommand("stop_home_worker", { input: { id } });
}
