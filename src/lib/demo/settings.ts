import type {
  AppSettings,
  Organization,
  ReviewResultPreview,
  SyncState,
  UpdateAppSettingsInput,
  WorkItemResultPreview,
} from "@/lib/azdoCommands";
import {
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
} from "@/lib/reviewSettings";

export const demoOrganization: Organization = {
  id: "contoso",
  name: "contoso",
  displayName: "Contoso",
  baseUrl: "https://dev.azure.com/contoso",
  authProvider: "pat",
  credentialKey: "azdodeck:org:contoso:pat",
  authenticatedUserId: "demo-user",
  authenticatedUserDisplayName: "Demo User",
  authenticatedUserUniqueName: "demo.user@example.com",
  createdAt: "2026-05-24T00:00:00Z",
  updatedAt: "2026-05-24T00:00:00Z",
  providerKind: "azdo",
};

export const DEMO_PREVIEW_IMAGE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='92' viewBox='0 0 320 92'%3E%3Crect width='320' height='92' rx='8' fill='%23eff6ff'/%3E%3Crect x='14' y='14' width='88' height='64' rx='5' fill='%232563eb'/%3E%3Crect x='116' y='22' width='178' height='10' rx='5' fill='%2393c5fd'/%3E%3Crect x='116' y='42' width='148' height='10' rx='5' fill='%23bfdbfe'/%3E%3Crect x='116' y='62' width='118' height='10' rx='5' fill='%23dbeafe'/%3E%3C/svg%3E";

export const writeCommands = new Set([
  "create_work_item",
  "add_work_item_comment",
  "add_work_item_link",
  "remove_work_item_link",
  "delete_work_item_comment",
  "update_work_item_comment",
  "set_work_item_comment_reaction",
  "update_work_item_fields",
  "set_work_items_state",
  "assign_work_items",
  "set_work_items_priority",
  "set_work_items_tags",
  "post_pull_request_comment",
  "set_pull_request_thread_status",
  "submit_pull_request_vote",
  "update_pull_request",
  "set_pull_request_reviewer_required",
  "remove_pull_request_reviewer",
  "update_pull_request_details",
  "edit_pull_request_comment",
  "delete_pull_request_comment",
  "rerun_pipeline_run",
  "queue_pipeline_run",
  "cancel_pipeline_run",
  "update_pipeline_approval",
  "update_pipeline_definition",
]);

export const DEFAULT_DEMO_SETTINGS: AppSettings = {
  reviewResultFolderPath: "C:\\reports\\azdo-reviews",
  workItemResultFolderPath: "C:\\reports\\azdo-work-items",
  showWindowHotkey: null,
  readOnlyValidationModeEnabled: false,
  desktopNotificationsEnabled: false,
  notificationContentPreviewEnabled: true,
  notifyWorkItemAssignments: true,
  notifyWorkItemStateChanges: true,
  notifyPrReviewRequests: true,
  notifyPrVoteResets: true,
  notifyPrCommentReplies: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  reviewStaleThresholdDays: DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  workItemStaleThresholdDays: DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
  notificationRules: [],
  experimentalFeaturesEnabled: false,
  experimentalUsageStats: false,
  experimentalRetryToasts: false,
  experimentalDiagnosticsExport: false,
  experimentalCrossOrgSummary: false,
  experimentalAutoUpdateCheck: false,
};

export const DEFAULT_DEMO_SYNC_STATES: SyncState[] = [
  {
    scope: "prs:contoso",
    orgId: "contoso",
    lastSyncedAt: "2026-05-27T08:00:00Z",
    errorCount: 0,
    lastError: null,
    lastWarning: null,
  },
  {
    scope: "work_items:contoso",
    orgId: "contoso",
    lastSyncedAt: "2026-05-27T08:00:00Z",
    errorCount: 0,
    lastError: null,
    lastWarning:
      "Work item sync fetched more than 200 IDs in 1 query result(s); largest result had 248 IDs and was loaded in batches.",
  },
];

export function applyDemoSettingsUpdate(
  current: AppSettings,
  input: UpdateAppSettingsInput | undefined,
): AppSettings {
  return {
    reviewResultFolderPath:
      input && "reviewResultFolderPath" in input
        ? input.reviewResultFolderPath?.trim() || null
        : current.reviewResultFolderPath,
    workItemResultFolderPath:
      input && "workItemResultFolderPath" in input
        ? input.workItemResultFolderPath?.trim() || null
        : current.workItemResultFolderPath,
    showWindowHotkey:
      input && "showWindowHotkey" in input
        ? input.showWindowHotkey?.trim() || null
        : current.showWindowHotkey,
    readOnlyValidationModeEnabled:
      input && "readOnlyValidationModeEnabled" in input
        ? Boolean(input.readOnlyValidationModeEnabled)
        : current.readOnlyValidationModeEnabled,
    desktopNotificationsEnabled:
      input && "desktopNotificationsEnabled" in input
        ? Boolean(input.desktopNotificationsEnabled)
        : current.desktopNotificationsEnabled,
    notificationContentPreviewEnabled:
      input && "notificationContentPreviewEnabled" in input
        ? Boolean(input.notificationContentPreviewEnabled)
        : current.notificationContentPreviewEnabled,
    notifyWorkItemAssignments:
      input && "notifyWorkItemAssignments" in input
        ? Boolean(input.notifyWorkItemAssignments)
        : current.notifyWorkItemAssignments,
    notifyWorkItemStateChanges:
      input && "notifyWorkItemStateChanges" in input
        ? Boolean(input.notifyWorkItemStateChanges)
        : current.notifyWorkItemStateChanges,
    notifyPrReviewRequests:
      input && "notifyPrReviewRequests" in input
        ? Boolean(input.notifyPrReviewRequests)
        : current.notifyPrReviewRequests,
    notifyPrVoteResets:
      input && "notifyPrVoteResets" in input
        ? Boolean(input.notifyPrVoteResets)
        : current.notifyPrVoteResets,
    notifyPrCommentReplies:
      input && "notifyPrCommentReplies" in input
        ? Boolean(input.notifyPrCommentReplies)
        : current.notifyPrCommentReplies,
    quietHoursEnabled:
      input && "quietHoursEnabled" in input
        ? Boolean(input.quietHoursEnabled)
        : current.quietHoursEnabled,
    quietHoursStart:
      input && "quietHoursStart" in input
        ? input.quietHoursStart?.trim() || current.quietHoursStart
        : current.quietHoursStart,
    quietHoursEnd:
      input && "quietHoursEnd" in input
        ? input.quietHoursEnd?.trim() || current.quietHoursEnd
        : current.quietHoursEnd,
    reviewStaleThresholdDays:
      input && "reviewStaleThresholdDays" in input
        ? Number(input.reviewStaleThresholdDays) || DEFAULT_REVIEW_STALE_THRESHOLD_DAYS
        : current.reviewStaleThresholdDays,
    workItemStaleThresholdDays:
      input && "workItemStaleThresholdDays" in input
        ? Number(input.workItemStaleThresholdDays) || DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS
        : current.workItemStaleThresholdDays,
    notificationRules:
      input && "notificationRules" in input
        ? (input.notificationRules ?? [])
        : current.notificationRules,
    experimentalFeaturesEnabled:
      input && "experimentalFeaturesEnabled" in input
        ? Boolean(input.experimentalFeaturesEnabled)
        : current.experimentalFeaturesEnabled,
    experimentalUsageStats:
      input && "experimentalUsageStats" in input
        ? Boolean(input.experimentalUsageStats)
        : current.experimentalUsageStats,
    experimentalRetryToasts:
      input && "experimentalRetryToasts" in input
        ? Boolean(input.experimentalRetryToasts)
        : current.experimentalRetryToasts,
    experimentalDiagnosticsExport:
      input && "experimentalDiagnosticsExport" in input
        ? Boolean(input.experimentalDiagnosticsExport)
        : current.experimentalDiagnosticsExport,
    experimentalCrossOrgSummary:
      input && "experimentalCrossOrgSummary" in input
        ? Boolean(input.experimentalCrossOrgSummary)
        : current.experimentalCrossOrgSummary,
    experimentalAutoUpdateCheck:
      input && "experimentalAutoUpdateCheck" in input
        ? Boolean(input.experimentalAutoUpdateCheck)
        : current.experimentalAutoUpdateCheck,
  };
}

/**
 * Browser-mode stand-in for `export_diagnostics`. Mirrors the Rust shape and
 * redaction behaviour (organization ids replaced everywhere they appear,
 * including inside sync scopes) but writes nothing and returns a fake path.
 */
export function demoDiagnosticsExport(
  folderPath: string | null,
  syncStates: SyncState[],
  redactOrganizations: boolean,
): { filePath: string; contents: string } {
  if (!folderPath) {
    throw new Error(
      "Set the review result folder in Settings before exporting diagnostics.",
    );
  }

  const orgIds: string[] = [];
  for (const state of syncStates) {
    if (!orgIds.includes(state.orgId)) orgIds.push(state.orgId);
  }
  const label = (orgId: string) => {
    if (!redactOrganizations) return orgId;
    const index = orgIds.indexOf(orgId);
    return index >= 0 ? `<org-${index + 1}>` : "<org>";
  };
  const scrub = (text: string) =>
    redactOrganizations
      ? orgIds.reduce((acc, id, i) => acc.split(id).join(`<org-${i + 1}>`), text)
      : text;

  const report = {
    appVersion: "0.1.16-demo",
    os: "browser",
    schemaVersion: 19,
    connections: [
      {
        organization: label(demoOrganization.id),
        providerKind: demoOrganization.providerKind,
        authProvider: demoOrganization.authProvider,
      },
    ],
    syncStates: syncStates.map((state) => ({
      scope: scrub(state.scope),
      organization: label(state.orgId),
      lastSyncedAt: state.lastSyncedAt,
      errorCount: state.errorCount,
    })),
    recentErrors: syncStates
      .filter((state) => state.lastError)
      .map((state) => `${label(state.orgId)}: ${scrub(state.lastError ?? "")}`),
  };

  return {
    filePath: `${folderPath}\\devdeck-diagnostics-demo.json`,
    contents: JSON.stringify(report, null, 2),
  };
}

export function demoReviewResultPreview(
  folderPath: string | null,
  pullRequestId: number | undefined,
): ReviewResultPreview | null {
  if (!folderPath || !pullRequestId) {
    return null;
  }
  if (pullRequestId !== 101 && pullRequestId !== 189) {
    return null;
  }

  const title =
    pullRequestId === 101
      ? "Rate limiting middleware review"
      : "Android payment crash review";
  return {
    pullRequestId,
    fileName: `review-PR${pullRequestId}.html`,
    filePath: `${folderPath}\\review-PR${pullRequestId}.html`,
    html: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { color: #111827; font: 14px/1.5 system-ui, sans-serif; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      .status { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 10px 12px; }
      code { background: #f3f4f6; border-radius: 4px; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p class="status">Review result file matched by <code>PR${pullRequestId}</code>.</p>
    <p>No blocking issues found in the generated review summary.</p>
  </body>
</html>`,
  };
}

export function demoWorkItemResultPreview(
  folderPath: string | null,
  workItemId: number | undefined,
): WorkItemResultPreview | null {
  if (!folderPath || !workItemId) {
    return null;
  }
  if (workItemId !== 123 && workItemId !== 118) {
    return null;
  }

  const title =
    workItemId === 123 ? "Rate limiting rollout analysis" : "Payment crash investigation";
  return {
    workItemId,
    fileName: `${workItemId}-result.html`,
    filePath: `${folderPath}\\${workItemId}-result.html`,
    html: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { color: #111827; font: 14px/1.5 system-ui, sans-serif; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      .status { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 10px 12px; }
      code { background: #f3f4f6; border-radius: 4px; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p class="status">Result file matched by work item id <code>${workItemId}</code>.</p>
    <p>No blocking issues found in the generated investigation summary.</p>
  </body>
</html>`,
  };
}
