import { parseNotificationPayload, type NotificationRecord } from "@/lib/azdoCommands";
import type { AgentSubject } from "@/components/agent/agentSubject";

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
    case "prReadyToMerge":
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
    case "pipelineInvestigationStarted":
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

/**
 * The PR / work item title in a notification's body: its first line (a reply puts it in
 * quotes), which the backend follows with a "repository / organization" line. Free-text
 * bodies have no such line and fall back to the notification title after its "kind: " prefix.
 */
function bodyTitle(record: NotificationRecord): string {
  const [first, ...rest] = record.body?.split("\n") ?? [];
  if (!first || rest.length === 0) return record.title?.match(/^[^:：]+[:：]\s*(.+)$/)?.[1] ?? "";
  return first.match(/ on "(.*)"$/)?.[1] ?? first;
}

/**
 * The pull request / work item a notification is about, as the Agent panel's
 * subject. The payload carries the project's name, not its id; Azure DevOps
 * accepts either in the REST path, so the name stands in for the id.
 */
export function resolveNotificationAgentSubject(record: NotificationRecord): AgentSubject | null {
  const parsed = parseNotificationPayload(record);
  const payload = parsed.payload as Record<string, unknown>;
  const organizationId = record.organizationId ?? undefined;
  const projectId = stringField(payload, "projectId") ?? stringField(payload, "projectName");
  const webUrl = stringField(payload, "webUrl");
  const title = bodyTitle(record);
  if (!projectId) return null;
  const target = resolveNotificationJump(record);
  if (target.type === "pullRequest") {
    const repositoryId = stringField(payload, "repositoryId");
    if (!repositoryId) return null;
    return {
      kind: "pull-request",
      id: target.pullRequestId,
      title,
      organizationId,
      projectId,
      repositoryId,
      repositoryName: stringField(payload, "repositoryName") ?? "",
      webUrl,
    };
  }
  if (target.type === "workItem") {
    return { kind: "work-item", id: target.workItemId, title, organizationId, projectId, webUrl };
  }
  return null;
}
