import { parseNotificationPayload, type NotificationRecord } from "@/lib/azdoCommands";

// Where `Enter`/click on a notification row should take the user, resolved
// from its kind + payload. `payload` is only validated as an untyped record by
// the wire schema (`azdoCommands.ts`), so every field read here is guarded and
// falls back to `webUrl` (opened externally) or `none` rather than trusting
// shapes that never arrived.
export type NotificationJumpTarget =
  | { type: "pullRequest"; pullRequestId: number; organizationId?: string }
  | { type: "workItem"; workItemId: number; organizationId?: string }
  | { type: "view"; view: "pipelines" | "settings" }
  | { type: "external"; url: string }
  | { type: "none" };

function numberField(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolveNotificationJump(record: NotificationRecord): NotificationJumpTarget {
  const parsed = parseNotificationPayload(record);
  const payload = parsed.payload as Record<string, unknown>;
  const organizationId = record.organizationId ?? undefined;

  switch (parsed.kind) {
    case "prReviewRequested":
    case "prVoteReset":
    case "prCommentReply": {
      const pullRequestId = numberField(payload, "pullRequestId");
      if (pullRequestId != null) return { type: "pullRequest", pullRequestId, organizationId };
      break;
    }
    case "wiAssigned":
    case "wiStateChanged": {
      const workItemId = numberField(payload, "workItemId");
      if (workItemId != null) return { type: "workItem", workItemId, organizationId };
      break;
    }
    case "pipelineWatchStarted":
    case "pipelineWatchFinished":
    case "pipelineRunQueued":
      return { type: "view", view: "pipelines" };
    case "syncFailed":
      return { type: "view", view: "settings" };
    default:
      break;
  }

  const webUrl = stringField(payload, "webUrl");
  return webUrl ? { type: "external", url: webUrl } : { type: "none" };
}

/** The row's secondary (open-in-browser) action, independent of the jump target. */
export function notificationWebUrl(record: NotificationRecord): string | null {
  const parsed = parseNotificationPayload(record);
  return stringField(parsed.payload as Record<string, unknown>, "webUrl");
}
