import { z } from "zod";
import { invokeCommand } from "./runtime";

// Kinds the backend raises today. The wire schema stays `z.string()` so a kind
// from a newer backend does not fail validation; `inboxKindLabel` falls back to
// the raw value.
export const INBOX_KINDS = ["pr_mention", "pr_group_mention", "pr_reply", "wi_mention", "wi_reply"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export type InboxListState = "open" | "snoozed" | "done";

const inboxInsightSchema = z.object({
  /** `pending` while Claude Code writes it, then `ready` or `failed`. */
  status: z.string(),
  /** `reply` (answer as is), `fix` (change the code first) or `none` (nothing to do). */
  verdict: z.string().nullable(),
  reason: z.string().nullable(),
  evidence: z
    .array(
      z.object({
        text: z.string(),
        location: z.string().nullable(),
        code: z.string().nullable(),
        /** Not confirmed in the code or the thread. */
        guess: z.boolean(),
      }),
    )
    .default([]),
  replyDraft: z.string().nullable(),
  error: z.string().nullable(),
});

export type InboxInsight = z.infer<typeof inboxInsightSchema>;

const inboxItemSchema = z.object({
  id: z.number(),
  organizationId: z.string(),
  kind: z.string(),
  subjectId: z.number(),
  projectId: z.string(),
  projectName: z.string(),
  repositoryId: z.string(),
  repositoryName: z.string(),
  threadId: z.number(),
  commentId: z.number(),
  title: z.string(),
  author: z.string().nullable(),
  snippet: z.string().nullable(),
  webUrl: z.string().nullable(),
  state: z.string(),
  snoozedUntil: z.string().nullable(),
  detectedAt: z.string(),
  doneAt: z.string().nullable(),
  /** Where a PR comment thread sits in the code; null for PR-wide threads and other kinds. */
  filePath: z.string().nullable().default(null),
  line: z.number().nullable().default(null),
  /** Comments waiting in this thread (PR) or work item; one row per conversation. */
  hitCount: z.number().default(1),
  /** Claude Code's summary (Settings → Inbox summaries); null until written or when off. */
  insight: inboxInsightSchema.nullable().default(null),
});

export type InboxItem = z.infer<typeof inboxItemSchema>;

const inboxCountsSchema = z.object({
  open: z.number(),
  snoozed: z.number(),
  done: z.number(),
});

export type InboxCounts = z.infer<typeof inboxCountsSchema>;

export type ListInboxItemsInput = {
  state: InboxListState;
  organizationId?: string;
  limit?: number;
};

export type SetInboxItemStateInput = {
  ids: number[];
  state: InboxListState;
  /** RFC 3339 deadline, required when `state` is `snoozed`. */
  snoozedUntil?: string;
};

export async function listActionInboxItems(input: ListInboxItemsInput): Promise<InboxItem[]> {
  const result = await invokeCommand("list_action_inbox_items", { input });
  return z.array(inboxItemSchema).parse(result);
}

export async function getActionInboxCounts(organizationId?: string): Promise<InboxCounts> {
  const result = await invokeCommand("get_action_inbox_counts", {
    organizationId: organizationId ?? null,
  });
  return inboxCountsSchema.parse(result);
}

/** Starts Claude's notes for one open item; the result arrives as an Inbox update. */
export async function generateActionInboxInsight(id: number): Promise<void> {
  await invokeCommand("generate_action_inbox_insight", { id });
}

export async function setActionInboxItemState(input: SetInboxItemStateInput): Promise<number> {
  const result = await invokeCommand("set_action_inbox_item_state", { input });
  return z.number().parse(result);
}
