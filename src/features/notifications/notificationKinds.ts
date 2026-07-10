import { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/azdoCommands";

// Human-readable labels for the notification kinds the backend emits, used by
// the kind filter and each row's chip. Kept as a lookup (not a switch) so the
// filter's option list and a row's label share one source.
const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  prReviewRequested: "Review requested",
  prVoteReset: "Vote reset",
  prCommentReply: "Comment reply",
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

export const NOTIFICATION_KIND_OPTIONS = NOTIFICATION_KINDS.map((kind) => ({
  value: kind,
  label: notificationKindLabel(kind),
}));
