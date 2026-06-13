import {
  isPermissionGranted,
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

export async function sendTestDesktopNotification(): Promise<DesktopNotificationResult> {
  return sendDesktopNotification("AzDoDeck notifications", {
    body: "Desktop notifications are ready.",
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

  let result: DesktopNotificationResult = "denied";
  for (const item of items) {
    result = await sendDesktopNotification(workItemNotificationTitle(item), {
      body: contentPreviewEnabled
        ? workItemNotificationBody(event.organizationName, item)
        : "Open AzDoDeck to review this work item update.",
      onClick: item.webUrl
        ? () => {
            void openExternalUrl(item.webUrl!);
          }
        : undefined,
    });
  }
  return result;
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

  sendNotification({
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}
