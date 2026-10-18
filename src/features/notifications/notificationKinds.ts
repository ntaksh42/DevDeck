import type { NotificationKind } from "@/lib/azdoCommands";

// Human-readable labels for the notification kinds the backend emits, used by
// each row's chip. Kept as a lookup (not a switch).
const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  prReviewRequested: "Review requested",
  prVoteReset: "Vote reset",
  prCommentReply: "Comment reply",
  prReadyToMerge: "Ready to merge",
  wiAssigned: "Work item assigned",
  wiStateChanged: "Work item state changed",
  syncFailed: "Sync failed",
  pipelineWatchStarted: "Pipeline started",
  pipelineWatchFinished: "Pipeline finished",
  pipelineRunQueued: "Pipeline queued",
};

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABELS[kind as NotificationKind] ?? kind;
}

export type NotificationCategory = "pr" | "workItem" | "pipeline" | "sync";

export const NOTIFICATION_CATEGORIES: { value: NotificationCategory; label: string }[] = [
  { value: "pr", label: "PR" },
  { value: "workItem", label: "Work item" },
  { value: "pipeline", label: "Pipeline" },
  { value: "sync", label: "Sync" },
];

export function notificationCategory(kind: string): NotificationCategory {
  if (kind.startsWith("pr")) return "pr";
  if (kind.startsWith("wi")) return "workItem";
  if (kind.startsWith("pipeline")) return "pipeline";
  return "sync";
}

/** Backend kinds in a category, for server-side filtering. */
export function notificationKindsIn(category: NotificationCategory): NotificationKind[] {
  return (Object.keys(NOTIFICATION_KIND_LABELS) as NotificationKind[]).filter(
    (kind) => notificationCategory(kind) === category,
  );
}
