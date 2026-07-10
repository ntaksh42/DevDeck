import { z } from "zod";
import { invokeCommand } from "./runtime";

// Kinds the backend currently emits. Kept as a union for callers that want to
// narrow, but the wire schema stays `z.string()` so an unrecognised kind from
// a newer backend does not fail validation.
export const NOTIFICATION_KINDS = [
  "prReviewRequested",
  "prVoteReset",
  "prCommentReply",
  "wiAssigned",
  "wiStateChanged",
  "syncFailed",
  "pipelineWatchStarted",
  "pipelineWatchFinished",
  "pipelineRunQueued",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const notificationRecordSchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  organizationId: z.string().nullable(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  isRead: z.boolean(),
});

export type NotificationRecord = z.infer<typeof notificationRecordSchema>;

const notificationListResultSchema = z.object({
  items: z.array(notificationRecordSchema),
  hasMore: z.boolean(),
});

export type NotificationListResult = z.infer<typeof notificationListResultSchema>;

// Payload shapes per kind, for callers that have already narrowed on `kind`.
export type PrNotificationPayload = {
  pullRequestId: number;
  repositoryId: string;
  repositoryName: string;
  projectName: string;
  webUrl: string | null;
  commentAuthor: string | null;
  snippet: string | null;
};

export type WorkItemNotificationPayload = {
  workItemId: number;
  projectName: string;
  state: string | null;
  previousState: string | null;
  webUrl: string | null;
};

export type SyncFailedNotificationPayload = {
  consecutiveFailures: number;
  retryInSecs: number;
  lastError: string | null;
};

export type PipelineNotificationPayload = {
  definitionName: string;
  projectName: string;
  buildNumber: string | null;
  sourceBranch: string | null;
  webUrl: string | null;
};

/** Discriminated union returned by `parseNotificationPayload`, narrowed on `kind`. */
export type ParsedNotificationPayload =
  | { kind: "prReviewRequested" | "prVoteReset" | "prCommentReply"; payload: PrNotificationPayload }
  | { kind: "wiAssigned" | "wiStateChanged"; payload: WorkItemNotificationPayload }
  | { kind: "syncFailed"; payload: SyncFailedNotificationPayload }
  | {
      kind: "pipelineWatchStarted" | "pipelineWatchFinished" | "pipelineRunQueued";
      payload: PipelineNotificationPayload;
    }
  | { kind: string; payload: Record<string, unknown> };

/** Narrows a notification record's untyped payload based on its `kind`. Unknown
 *  kinds fall through to the untyped variant instead of throwing. */
export function parseNotificationPayload(record: NotificationRecord): ParsedNotificationPayload {
  switch (record.kind) {
    case "prReviewRequested":
    case "prVoteReset":
    case "prCommentReply":
      return { kind: record.kind, payload: record.payload as PrNotificationPayload };
    case "wiAssigned":
    case "wiStateChanged":
      return { kind: record.kind, payload: record.payload as WorkItemNotificationPayload };
    case "syncFailed":
      return { kind: record.kind, payload: record.payload as SyncFailedNotificationPayload };
    case "pipelineWatchStarted":
    case "pipelineWatchFinished":
    case "pipelineRunQueued":
      return { kind: record.kind, payload: record.payload as PipelineNotificationPayload };
    default:
      return { kind: record.kind, payload: record.payload };
  }
}

export type ListNotificationsInput = {
  organizationId?: string;
  limit: number;
  beforeId?: number;
  unreadOnly?: boolean;
  kinds?: string[];
};

export type RecordNotificationInput = {
  organizationId?: string;
  kind: NotificationKind | string;
  title: string;
  body?: string | null;
  payload: Record<string, unknown>;
};

export async function listNotifications(
  input: ListNotificationsInput,
): Promise<NotificationListResult> {
  const result = await invokeCommand("list_notifications", { input });
  return notificationListResultSchema.parse(result);
}

export async function getUnreadNotificationsCount(): Promise<number> {
  const result = await invokeCommand("get_unread_notifications_count");
  return z.number().parse(result);
}

export async function markNotificationsRead(input: { ids: number[] }): Promise<void> {
  await invokeCommand("mark_notifications_read", { input });
}

export async function markAllNotificationsRead(): Promise<void> {
  await invokeCommand("mark_all_notifications_read");
}

export async function recordNotification(input: RecordNotificationInput): Promise<void> {
  await invokeCommand("record_notification", { input });
}
