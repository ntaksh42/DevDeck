import { z } from "zod";
import {
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
} from "@/lib/reviewSettings";
import { invokeCommand } from "./runtime";

export {
  REVIEW_STALE_THRESHOLD_DAY_OPTIONS,
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS,
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
} from "@/lib/reviewSettings";

// Notification kinds a rule can match. Values mirror the camelCase enum keys the
// backend uses (PrNotificationKind / WorkItemNotificationKind).
export const NOTIFICATION_RULE_TYPES = [
  { value: "reviewRequested", label: "PR review requested" },
  { value: "voteReset", label: "PR vote reset" },
  { value: "commentReply", label: "PR comment reply" },
  { value: "assigned", label: "Work item assigned" },
  { value: "stateChanged", label: "Work item state changed" },
] as const;

const notificationRuleSchema = z.object({
  types: z.array(z.string()).default([]),
  projects: z.array(z.string()).default([]),
  repositories: z.array(z.string()).default([]),
  // When true, matching notifications are muted (suppressed) instead of allowed.
  // Mute rules take precedence over allow rules.
  mute: z.boolean().default(false),
});

export type NotificationRule = z.infer<typeof notificationRuleSchema>;

const appSettingsSchema = z.object({
  reviewResultFolderPath: z.string().nullable(),
  showWindowHotkey: z.string().nullable().default(null),
  readOnlyValidationModeEnabled: z.boolean().default(false),
  desktopNotificationsEnabled: z.boolean().default(false),
  notificationContentPreviewEnabled: z.boolean().default(true),
  notifyWorkItemAssignments: z.boolean().default(true),
  notifyWorkItemStateChanges: z.boolean().default(true),
  notifyPrReviewRequests: z.boolean().default(true),
  notifyPrVoteResets: z.boolean().default(true),
  notifyPrCommentReplies: z.boolean().default(true),
  reviewStaleThresholdDays: z.number().int().default(DEFAULT_REVIEW_STALE_THRESHOLD_DAYS),
  workItemStaleThresholdDays: z
    .number()
    .int()
    .default(DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS),
  notificationRules: z.array(notificationRuleSchema).default([]),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

const reviewResultPreviewSchema = z.object({
  pullRequestId: z.number(),
  fileName: z.string(),
  filePath: z.string(),
  html: z.string(),
});

export type ReviewResultPreview = z.infer<typeof reviewResultPreviewSchema>;

const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  baseUrl: z.string(),
  authProvider: z.string(),
  credentialKey: z.string(),
  authenticatedUserId: z.string().nullable(),
  authenticatedUserDisplayName: z.string().nullable(),
  authenticatedUserUniqueName: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Platform this connection targets. Defaults to "azdo" for connections that
  // predate provider awareness.
  providerKind: z.enum(["azdo", "github"]).default("azdo"),
});

const organizationsSchema = z.array(organizationSchema);

export type Organization = z.infer<typeof organizationSchema>;

// Capabilities of the active connection's provider. The UI reads these to hide
// features the active platform does not support, so screens never branch on the
// provider kind directly.
const providerCapabilitiesSchema = z.object({
  pullRequests: z.boolean(),
  pullRequestReview: z.boolean(),
  workItems: z.boolean(),
  commits: z.boolean(),
  codeSearch: z.boolean(),
  codeBrowse: z.boolean(),
  pipelines: z.boolean(),
  wiki: z.boolean(),
  workItemPriority: z.boolean(),
  resolveReviewThreads: z.boolean(),
});

const providerInfoSchema = z.object({
  kind: z.string(),
  capabilities: providerCapabilitiesSchema,
});

export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

const syncScopeSchema = z.enum(["all", "hot", "myReviews", "myWorkItems", "commits"]);

export type SyncScope = z.infer<typeof syncScopeSchema>;

const syncStateSchema = z.object({
  scope: z.string(),
  orgId: z.string(),
  lastSyncedAt: z.string().nullable(),
  errorCount: z.number(),
  lastError: z.string().nullable(),
  lastWarning: z.string().nullable().default(null),
});

const syncStatesSchema = z.array(syncStateSchema);

export type SyncState = z.infer<typeof syncStateSchema>;

export const syncUpdatedEventSchema = z.object({
  orgId: z.string(),
  scopes: z.array(syncScopeSchema),
});

export type AddPatOrganizationInput = {
  organization: string;
  pat: string;
};

export type AddAzureCliOrganizationInput = {
  organization: string;
};

export type AddGitHubOrganizationInput = {
  pat: string;
};

export type DeleteOrganizationInput = {
  id: string;
};

export type UpdateAppSettingsInput = {
  reviewResultFolderPath?: string | null;
  showWindowHotkey?: string | null;
  readOnlyValidationModeEnabled?: boolean;
  desktopNotificationsEnabled?: boolean;
  notificationContentPreviewEnabled?: boolean;
  notifyWorkItemAssignments?: boolean;
  notifyWorkItemStateChanges?: boolean;
  notifyPrReviewRequests?: boolean;
  notifyPrVoteResets?: boolean;
  notifyPrCommentReplies?: boolean;
  reviewStaleThresholdDays?: number;
  workItemStaleThresholdDays?: number;
  notificationRules?: NotificationRule[];
};

export type GetReviewResultPreviewInput = {
  pullRequestId: number;
};

export type TriggerSyncInput = {
  scope?: SyncScope;
};

export async function listOrganizations(): Promise<Organization[]> {
  const result = await invokeCommand("list_organizations");
  return organizationsSchema.parse(result);
}

export async function getAppSettings(): Promise<AppSettings> {
  const result = await invokeCommand("get_app_settings");
  return appSettingsSchema.parse(result);
}

export async function updateAppSettings(
  input: UpdateAppSettingsInput,
): Promise<AppSettings> {
  const result = await invokeCommand("update_app_settings", { input });
  return appSettingsSchema.parse(result);
}

export async function getReviewResultPreview(
  input: GetReviewResultPreviewInput,
): Promise<ReviewResultPreview | null> {
  const result = await invokeCommand("get_review_result_preview", { input });
  return reviewResultPreviewSchema.nullable().parse(result);
}

export async function addPatOrganization(
  input: AddPatOrganizationInput,
): Promise<Organization> {
  const result = await invokeCommand("add_pat_organization", { input });
  return organizationSchema.parse(result);
}

export async function addAzureCliOrganization(
  input: AddAzureCliOrganizationInput,
): Promise<Organization> {
  const result = await invokeCommand("add_azure_cli_organization", { input });
  return organizationSchema.parse(result);
}

export async function addGithubOrganization(
  input: AddGitHubOrganizationInput,
): Promise<Organization> {
  const result = await invokeCommand("add_github_organization", { input });
  return organizationSchema.parse(result);
}

export async function deleteOrganization(
  input: DeleteOrganizationInput,
): Promise<void> {
  await invokeCommand("delete_organization", { id: input.id });
}

export async function getActiveOrganization(): Promise<Organization | null> {
  const result = await invokeCommand("get_active_organization");
  return organizationSchema.nullable().parse(result);
}

export async function setActiveOrganization(id: string): Promise<Organization> {
  const result = await invokeCommand("set_active_organization", { id });
  return organizationSchema.parse(result);
}

export async function getProviderCapabilities(): Promise<ProviderInfo> {
  const result = await invokeCommand("get_provider_capabilities");
  return providerInfoSchema.parse(result);
}

export async function listSyncStates(): Promise<SyncState[]> {
  const result = await invokeCommand("list_sync_states");
  return syncStatesSchema.parse(result);
}

export async function triggerSync(input: TriggerSyncInput = {}): Promise<void> {
  await invokeCommand("trigger_sync", { input });
}
