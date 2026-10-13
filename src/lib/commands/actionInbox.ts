import { z } from "zod";
import { invokeCommand } from "./runtime";

// Kinds the backend raises today. The wire schema stays `z.string()` so a kind
// from a newer backend does not fail validation; `inboxKindLabel` falls back to
// the raw value.
export const INBOX_KINDS = ["pr_mention", "pr_reply"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export type InboxListState = "open" | "snoozed" | "done";

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

export async function setActionInboxItemState(input: SetInboxItemStateInput): Promise<number> {
  const result = await invokeCommand("set_action_inbox_item_state", { input });
  return z.number().parse(result);
}
