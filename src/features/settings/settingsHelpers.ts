import {
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
  type AppSettings,
  type UpdateAppSettingsInput,
} from '@/lib/azdoCommands';

export function settingsInput(
  settings: AppSettings | undefined,
  input: UpdateAppSettingsInput,
): UpdateAppSettingsInput {
  return {
    reviewResultFolderPath: settings?.reviewResultFolderPath ?? null,
    showWindowHotkey: settings?.showWindowHotkey ?? null,
    readOnlyValidationModeEnabled:
      settings?.readOnlyValidationModeEnabled ?? false,
    desktopNotificationsEnabled: settings?.desktopNotificationsEnabled ?? false,
    notificationContentPreviewEnabled:
      settings?.notificationContentPreviewEnabled ?? true,
    notifyWorkItemAssignments: settings?.notifyWorkItemAssignments ?? true,
    notifyWorkItemStateChanges: settings?.notifyWorkItemStateChanges ?? true,
    notifyPrReviewRequests: settings?.notifyPrReviewRequests ?? true,
    notifyPrVoteResets: settings?.notifyPrVoteResets ?? true,
    notifyPrCommentReplies: settings?.notifyPrCommentReplies ?? true,
    quietHoursEnabled: settings?.quietHoursEnabled ?? false,
    quietHoursStart: settings?.quietHoursStart ?? "22:00",
    quietHoursEnd: settings?.quietHoursEnd ?? "08:00",
    reviewStaleThresholdDays:
      settings?.reviewStaleThresholdDays ?? DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
    workItemStaleThresholdDays:
      settings?.workItemStaleThresholdDays ??
      DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
    notificationRules: settings?.notificationRules ?? [],
    ...input,
  };
}
