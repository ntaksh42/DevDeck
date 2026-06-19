import {
  isPermissionGranted,
  onAction,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AppSettings } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { isTauriRuntime } from "@/lib/runtime";

export type DesktopNotificationResult = "sent" | "unsupported" | "denied" | "skipped";

export type WorkItemNotificationEvent = {
  organizationId: string;
  organizationName: string;
  items: WorkItemNotificationItem[];
};

type WorkItemNotificationItem = {
  kind: "assigned" | "stateChanged";
  id: number;
  title: string;
  projectName: string;
  state: string | null;
  previousState: string | null;
  assignedTo: string | null;
  webUrl: string | null;
};

export type PullRequestNotificationEvent = {
  organizationId: string;
  organizationName: string;
  items: PullRequestNotificationItem[];
};

type PullRequestNotificationItem = {
  kind: "reviewRequested" | "voteReset" | "commentReply";
  pullRequestId: number;
  title: string;
  repositoryName: string;
  projectName: string;
  webUrl: string | null;
  commentAuthor: string | null;
  snippet: string | null;
};

export async function sendTestDesktopNotification(): Promise<DesktopNotificationResult> {
  return sendDesktopNotification("AzDoDeck notifications", {
    body: "Desktop notifications are ready.",
  });
}

// Surfaces the outcome of a manually triggered pipeline run. `webUrl` opens the
// build results page when the toast is clicked.
export async function sendPipelineRunNotification(input: {
  ok: boolean;
  pipelineName: string;
  detail: string;
  webUrl?: string | null;
}): Promise<DesktopNotificationResult> {
  const title = input.ok
    ? `Pipeline queued: ${input.pipelineName}`
    : `Pipeline failed to start: ${input.pipelineName}`;
  return sendDesktopNotification(title, {
    body: input.detail,
    onClick: input.webUrl
      ? () => {
          void openExternalUrl(input.webUrl!);
        }
      : undefined,
  });
}

export async function showWorkItemNotificationEvent(
  event: WorkItemNotificationEvent,
  settings: AppSettings,
): Promise<DesktopNotificationResult> {
  if (!settings.desktopNotificationsEnabled || event.items.length === 0) {
    return "skipped";
  }

  const contentPreviewEnabled = settings.notificationContentPreviewEnabled;
  const items = event.items.slice(0, 20);
  if (items.length > 3) {
    return sendDesktopNotification(`${items.length} work item updates`, {
      body: contentPreviewEnabled
        ? `${event.organizationName}: ${items
            .slice(0, 3)
            .map((item) => `#${item.id} ${item.title}`)
            .join(", ")}`
        : "Open AzDoDeck to review the latest work item updates.",
    });
  }

  const results: DesktopNotificationResult[] = [];
  for (const item of items) {
    results.push(
      await sendDesktopNotification(workItemNotificationTitle(item), {
        body: contentPreviewEnabled
          ? workItemNotificationBody(event.organizationName, item)
          : "Open AzDoDeck to review this work item update.",
        onClick: item.webUrl
          ? () => {
              void openExternalUrl(item.webUrl!);
            }
          : undefined,
      }),
    );
  }
  return combineNotificationResults(results);
}

export async function showPullRequestNotificationEvent(
  event: PullRequestNotificationEvent,
  settings: AppSettings,
): Promise<DesktopNotificationResult> {
  if (!settings.desktopNotificationsEnabled || event.items.length === 0) {
    return "skipped";
  }

  const contentPreviewEnabled = settings.notificationContentPreviewEnabled;
  const items = event.items.slice(0, 20);
  if (items.length > 3) {
    return sendDesktopNotification(`${items.length} pull request updates`, {
      body: contentPreviewEnabled
        ? `${event.organizationName}: ${items
            .slice(0, 3)
            .map((item) => `!${item.pullRequestId} ${item.title}`)
            .join(", ")}`
        : "Open AzDoDeck to review the latest pull request updates.",
    });
  }

  const results: DesktopNotificationResult[] = [];
  for (const item of items) {
    results.push(
      await sendDesktopNotification(pullRequestNotificationTitle(item), {
        body: contentPreviewEnabled
          ? pullRequestNotificationBody(event.organizationName, item)
          : "Open AzDoDeck to review this pull request update.",
        onClick: item.webUrl
          ? () => {
              void openExternalUrl(item.webUrl!);
            }
          : undefined,
      }),
    );
  }
  return combineNotificationResults(results);
}

// Aggregates per-notification outcomes so a single failure is not masked by a
// later success. Severity order: denied/unsupported (failures) beat sent, which
// beats skipped.
function combineNotificationResults(
  results: DesktopNotificationResult[],
): DesktopNotificationResult {
  if (results.length === 0) return "skipped";
  if (results.includes("denied")) return "denied";
  if (results.includes("unsupported")) return "unsupported";
  if (results.includes("sent")) return "sent";
  return "skipped";
}

async function sendDesktopNotification(
  title: string,
  options: { body: string; onClick?: () => void },
): Promise<DesktopNotificationResult> {
  if (isTauriRuntime()) {
    return sendTauriDesktopNotification(title, options);
  }

  if (!("Notification" in window)) {
    return "unsupported";
  }

  const permission = await notificationPermission();
  if (permission !== "granted") {
    return "denied";
  }

  const notification = new Notification(title, {
    body: options.body,
    silent: false,
  });
  notification.onclick = () => {
    window.focus();
    options.onClick?.();
    notification.close();
  };
  return "sent";
}

// The Tauri notification plugin does not invoke a JS callback directly; instead
// it emits an `actionPerformed` event (via `onAction`) when the user clicks a
// toast, identifying the notification by its numeric id. We assign each
// notification a unique id, remember its click handler, and dispatch the stored
// handler when the matching event arrives.
const MAX_PENDING_TAURI_HANDLERS = 100;
const tauriNotificationHandlers = new Map<number, () => void>();
let nextTauriNotificationId = 1;
let tauriActionListenerPromise: Promise<unknown> | null = null;

function ensureTauriActionListener(): void {
  if (tauriActionListenerPromise) {
    return;
  }
  tauriActionListenerPromise = onAction((notification) => {
    const id = notification.id;
    if (typeof id !== "number") {
      return;
    }
    const handler = tauriNotificationHandlers.get(id);
    if (handler) {
      tauriNotificationHandlers.delete(id);
      handler();
    }
  }).catch(() => {
    // If the listener fails to register, clear the promise so a later
    // notification can retry. Returning (not rethrowing) avoids an unhandled
    // rejection, since nothing awaits this promise.
    tauriActionListenerPromise = null;
  });
}

async function sendTauriDesktopNotification(
  title: string,
  options: { body: string; onClick?: () => void },
): Promise<DesktopNotificationResult> {
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === "granted";
  }
  if (!permissionGranted) {
    return "denied";
  }

  let id: number | undefined;
  if (options.onClick) {
    ensureTauriActionListener();
    id = nextTauriNotificationId++;
    // Toasts that are dismissed without a click never fire `actionPerformed`,
    // so bound the map to avoid leaking handlers over a long-lived session.
    if (tauriNotificationHandlers.size >= MAX_PENDING_TAURI_HANDLERS) {
      const oldest = tauriNotificationHandlers.keys().next().value;
      if (oldest !== undefined) {
        tauriNotificationHandlers.delete(oldest);
      }
    }
    tauriNotificationHandlers.set(id, options.onClick);
  }

  sendNotification({
    id,
    title,
    body: options.body,
  });
  return "sent";
}

async function notificationPermission(): Promise<NotificationPermission> {
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

function workItemNotificationTitle(item: WorkItemNotificationItem): string {
  if (item.kind === "assigned") {
    return `Assigned: #${item.id}`;
  }
  return `State changed: #${item.id}`;
}

function workItemNotificationBody(
  organizationName: string,
  item: WorkItemNotificationItem,
): string {
  const title = truncate(item.title, 90);
  if (item.kind === "stateChanged") {
    const from = item.previousState ?? "Unknown";
    const to = item.state ?? "Unknown";
    return `${title}\n${from} -> ${to} / ${organizationName}`;
  }
  return `${title}\n${item.projectName} / ${organizationName}`;
}

function pullRequestNotificationTitle(item: PullRequestNotificationItem): string {
  switch (item.kind) {
    case "reviewRequested":
      return `Review requested: !${item.pullRequestId}`;
    case "voteReset":
      return `Vote reset: !${item.pullRequestId}`;
    case "commentReply":
      return `New reply: !${item.pullRequestId}`;
  }
}

function pullRequestNotificationBody(
  organizationName: string,
  item: PullRequestNotificationItem,
): string {
  const title = truncate(item.title, 90);
  if (item.kind === "commentReply") {
    const who = item.commentAuthor ?? "Someone";
    const snippet = item.snippet ? `\n${truncate(item.snippet, 90)}` : "";
    return `${who} on "${title}"${snippet}\n${item.repositoryName} / ${organizationName}`;
  }
  return `${title}\n${item.repositoryName} / ${organizationName}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
