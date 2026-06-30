import type {
  AddAzureCliOrganizationInput,
  AddPatOrganizationInput,
  AddWorkItemCommentInput,
  AppSettings,
  AssignWorkItemsInput,
  DeleteWorkItemCommentInput,
  DeletePullRequestCommentInput,
  EditPullRequestCommentInput,
  GetPullRequestFileDiffInput,
  GetPullRequestReviewInput,
  GetReviewResultPreviewInput,
  GetSavedQueryInput,
  GetWorkItemPreviewInput,
  ListPullRequestChangesInput,
  ListWorkItemFieldAllowedValuesInput,
  ListWorkItemFieldsInput,
  ListWorkItemTypeStatesInput,
  PostPullRequestCommentInput,
  PullRequestChanges,
  RunWorkItemQueryInput,
  SearchAllInput,
  SearchAllResult,
  SearchPullRequestsInput,
  SearchPullRequestMentionsInput,
  SearchWorkItemAssigneesInput,
  SearchWorkItemMentionsInput,
  SearchWorkItemsInput,
  SetPullRequestThreadStatusInput,
  SetWorkItemsPriorityInput,
  SetWorkItemsStateInput,
  SubmitPullRequestVoteInput,
  SyncState,
  UpdateAppSettingsInput,
  UpdateWorkItemCommentInput,
  UpdateWorkItemFieldsInput,
} from "@/lib/azdoCommands";
import {
  demoResponseDelayMs,
  shouldFailDemoCommand,
} from "@/lib/azdoDemoHarness";
import {
  DEFAULT_DEMO_SETTINGS,
  DEFAULT_DEMO_SYNC_STATES,
  applyDemoSettingsUpdate,
  demoOrganization,
  demoReviewResultPreview,
  DEMO_PREVIEW_IMAGE_DATA_URL,
  writeCommands,
} from "@/lib/demo/settings";
import {
  demoPrReviewDetail,
  demoPullRequests,
  demoMyCreatedPullRequests,
  demoReviewPullRequests,
  setDemoPrVote,
} from "@/lib/demo/prData";
import {
  demoVoteLabel,
  demoPrFilesFor,
  demoPrCommits,
  demoPrFileDiff,
  demoPostPrComment,
  demoEditPrComment,
  demoDeletePrComment,
  demoSetPrThreadStatus,
} from "@/lib/demo/prReview";
import {
  deleteDemoWorkItemComment,
  demoMyWorkItems,
  demoRunWorkItemQuery,
  demoUpdateWorkItemFields,
  demoWorkItemComment,
  demoWorkItemPreview,
  demoWorkItems,
  demoWorkItemProjects,
  toggleDemoReaction,
} from "@/lib/demo/workItems";
import {
  demoAssigneeCandidates,
  demoClassificationNodes,
  demoListWorkItemFieldAllowedValues,
  demoListWorkItemFields,
  demoListWorkItemTypeStates,
  demoMentionCandidates,
  demoWorkItemUpdates,
} from "@/lib/demo/workItemFields";
import {
  demoListSnoozedItems,
  demoSnoozeItem,
  demoSnoozedKeys,
  demoUnsnoozeItem,
} from "@/lib/demo/snooze";
import { demoCommits } from "@/lib/demo/commits";
import { dispatchExt } from "@/lib/demo/dispatchExt";

let demoSettings: AppSettings = { ...DEFAULT_DEMO_SETTINGS };
let demoSyncStates: SyncState[] = DEFAULT_DEMO_SYNC_STATES.map((s) => ({ ...s }));

export async function demoInvoke(command: string, args?: unknown): Promise<unknown> {
  await new Promise((resolve) => window.setTimeout(resolve, demoResponseDelayMs()));

  if (shouldFailDemoCommand(command)) {
    throw new Error(`Demo harness forced ${command} to fail`);
  }
  if (writeCommands.has(command) && demoSettings.readOnlyValidationModeEnabled) {
    throw new Error(
      "Read-only validation mode is enabled. Disable it in Settings to write to Azure DevOps.",
    );
  }

  switch (command) {
    case "list_organizations":
      return [demoOrganization];
    case "get_active_organization":
      return demoOrganization;
    case "set_active_organization":
      return demoOrganization;
    case "get_provider_capabilities":
      return {
        kind: "azdo",
        capabilities: {
          pullRequests: true,
          pullRequestReview: true,
          workItems: true,
          commits: true,
          codeSearch: true,
          codeBrowse: true,
          pipelines: true,
          wiki: true,
          workItemPriority: true,
          resolveReviewThreads: true,
        },
      };
    case "get_app_settings":
      return demoSettings;
    case "update_app_settings": {
      const input = (args as { input?: UpdateAppSettingsInput } | undefined)?.input;
      demoSettings = applyDemoSettingsUpdate(demoSettings, input);
      return demoSettings;
    }
    case "get_review_result_preview": {
      const input = (args as { input?: GetReviewResultPreviewInput } | undefined)?.input;
      return demoReviewResultPreview(demoSettings.reviewResultFolderPath, input?.pullRequestId);
    }
    case "add_pat_organization": {
      const input = (args as { input?: AddPatOrganizationInput } | undefined)?.input;
      return {
        ...demoOrganization,
        id: input?.organization || demoOrganization.id,
        name: input?.organization || demoOrganization.name,
        baseUrl: `https://dev.azure.com/${input?.organization || demoOrganization.name}`,
      };
    }
    case "add_azure_cli_organization": {
      const input = (args as { input?: AddAzureCliOrganizationInput } | undefined)?.input;
      return {
        ...demoOrganization,
        id: input?.organization || demoOrganization.id,
        name: input?.organization || demoOrganization.name,
        baseUrl: `https://dev.azure.com/${input?.organization || demoOrganization.name}`,
        authProvider: "azure_cli",
        credentialKey: `azdodeck:org:${input?.organization || demoOrganization.name}:azure-cli`,
      };
    }
    case "add_github_organization": {
      return {
        ...demoOrganization,
        id: "github:octocat",
        name: "github:octocat",
        displayName: "octocat",
        baseUrl: "https://api.github.com",
        authProvider: "github_pat",
        credentialKey: "azdodeck:github:octocat:pat",
        authenticatedUserDisplayName: "The Octocat",
        authenticatedUserUniqueName: "octocat@github.com",
        providerKind: "github",
      };
    }
    case "search_pull_requests": {
      const input = (args as { input?: SearchPullRequestsInput } | undefined)?.input;
      return demoPullRequests(input);
    }
    case "list_my_review_pull_requests": {
      const snoozed = demoSnoozedKeys("pull_request");
      return demoReviewPullRequests().filter(
        (pr) => !snoozed.has(`${pr.repositoryId}:${pr.pullRequestId}`),
      );
    }
    case "list_my_created_pull_requests":
      return demoMyCreatedPullRequests();
    case "get_pull_request_review": {
      const input = (args as { input?: GetPullRequestReviewInput } | undefined)?.input;
      return demoPrReviewDetail(input?.pullRequestId ?? 0);
    }
    case "list_pull_request_commits":
      return demoPrCommits;
    case "list_pull_request_changes": {
      const input = (args as { input?: ListPullRequestChangesInput } | undefined)?.input;
      const changes: PullRequestChanges = {
        baseCommitId: "demo-base",
        targetCommitId: "demo-target",
        files: demoPrFilesFor(input?.pullRequestId ?? 0),
      };
      return changes;
    }
    case "get_pull_request_file_diff": {
      const input = (args as { input?: GetPullRequestFileDiffInput } | undefined)?.input;
      return demoPrFileDiff(input);
    }
    case "post_pull_request_comment": {
      const input = (args as { input?: PostPullRequestCommentInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoPostPrComment(input);
    }
    case "edit_pull_request_comment": {
      const input = (args as { input?: EditPullRequestCommentInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoEditPrComment(input);
    }
    case "delete_pull_request_comment": {
      const input = (args as { input?: DeletePullRequestCommentInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoDeletePrComment(input);
    }
    case "set_pull_request_thread_status": {
      const input = (args as { input?: SetPullRequestThreadStatusInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoSetPrThreadStatus(input);
    }
    case "submit_pull_request_vote": {
      const input = (args as { input?: SubmitPullRequestVoteInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      setDemoPrVote(input.pullRequestId, input.vote);
      return {
        id: "demo-user",
        displayName: "Demo User",
        vote: input.vote,
        voteLabel: demoVoteLabel(input.vote),
        isRequired: true,
        isMe: true,
      };
    }
    case "set_pull_request_reviewer_required":
    case "remove_pull_request_reviewer":
      return null;
    case "update_pull_request": {
      const input = (args as { input?: { action?: string; pullRequestId?: number } } | undefined)
        ?.input;
      const action = input?.action;
      // publish and complete clear draft; abandon/reactivate keep the PR's original draft state.
      const originalDraft =
        demoReviewPullRequests().find((pr) => pr.pullRequestId === input?.pullRequestId)?.isDraft ??
        false;
      const isDraft = action === "publish" || action === "complete" ? false : originalDraft;
      return {
        status: action === "abandon" ? "abandoned" : action === "complete" ? "completed" : "active",
        isDraft,
      };
    }
    case "update_pull_request_details": {
      const input = (args as { input?: { title?: string; description?: string } } | undefined)
        ?.input;
      return {
        title: input?.title ?? "",
        description: input?.description?.trim() ? input.description : null,
      };
    }
    case "search_work_items": {
      const input = (args as { input?: SearchWorkItemsInput } | undefined)?.input;
      return demoWorkItems(input);
    }
    case "search_all": {
      const input = (args as { input?: SearchAllInput } | undefined)?.input;
      const query = input?.query.trim() ?? "";
      const limit = input?.limitPerKind ?? 5;
      if (!query) {
        return {
          workItems: [],
          pullRequests: [],
          commits: [],
          totals: { workItems: 0, pullRequests: 0, commits: 0 },
        } satisfies SearchAllResult;
      }
      const workItems = demoWorkItems({ query });
      const pullRequests = demoPullRequests({ query }).pullRequests;
      const commits = demoCommits({ query });
      return {
        workItems: workItems.slice(0, limit),
        pullRequests: pullRequests.slice(0, limit),
        commits: commits.slice(0, limit),
        totals: {
          workItems: workItems.length,
          pullRequests: pullRequests.length,
          commits: commits.length,
        },
      } satisfies SearchAllResult;
    }
    case "list_my_work_items": {
      const snoozed = demoSnoozedKeys("work_item");
      return demoMyWorkItems().filter((item) => !snoozed.has(String(item.id)));
    }
    case "list_work_item_projects":
      return demoWorkItemProjects();
    case "run_work_item_query": {
      const input = (args as { input?: RunWorkItemQueryInput } | undefined)?.input;
      return demoRunWorkItemQuery(input);
    }
    case "count_work_item_query": {
      const input = (args as { input?: RunWorkItemQueryInput } | undefined)?.input;
      return demoRunWorkItemQuery(input).length;
    }
    case "get_work_item_preview": {
      const input = (args as { input?: GetWorkItemPreviewInput } | undefined)?.input;
      return demoWorkItemPreview(input);
    }
    case "search_work_item_mentions": {
      const input = (args as { input?: SearchWorkItemMentionsInput } | undefined)?.input;
      return demoMentionCandidates(input?.query);
    }
    case "search_pull_request_mentions": {
      const input = (args as { input?: SearchPullRequestMentionsInput } | undefined)?.input;
      return demoMentionCandidates(input?.query);
    }
    case "search_work_item_assignees": {
      const input = (args as { input?: SearchWorkItemAssigneesInput } | undefined)?.input;
      return demoAssigneeCandidates(input?.query);
    }
    case "fetch_work_item_image":
      return { dataUrl: DEMO_PREVIEW_IMAGE_DATA_URL };
    case "add_work_item_comment": {
      const input = (args as { input?: AddWorkItemCommentInput } | undefined)?.input;
      return demoWorkItemComment(input?.markdown);
    }
    case "add_work_item_link":
    case "remove_work_item_link":
      return null;
    case "delete_work_item_comment": {
      const input = (args as { input?: DeleteWorkItemCommentInput } | undefined)?.input;
      if (input) deleteDemoWorkItemComment(input.commentId);
      return null;
    }
    case "update_work_item_comment": {
      const input = (args as { input?: UpdateWorkItemCommentInput } | undefined)?.input;
      const comment = demoWorkItemComment(input?.markdown);
      return { ...comment, id: input?.commentId ?? comment.id };
    }
    case "set_work_item_comment_reaction": {
      const input = (
        args as
          | { input?: { commentId?: number; reactionType?: string; engaged?: boolean } }
          | undefined
      )?.input;
      if (input?.commentId != null && input.reactionType) {
        toggleDemoReaction(input.commentId, input.reactionType, !!input.engaged);
      }
      return null;
    }
    case "update_work_item_fields": {
      const input = (args as { input?: UpdateWorkItemFieldsInput } | undefined)?.input;
      return demoUpdateWorkItemFields(input);
    }
    case "list_work_item_updates":
      return demoWorkItemUpdates();
    case "list_work_item_field_allowed_values": {
      const input = (args as { input?: ListWorkItemFieldAllowedValuesInput } | undefined)?.input;
      return demoListWorkItemFieldAllowedValues(input);
    }
    case "list_work_item_type_states": {
      const input = (args as { input?: ListWorkItemTypeStatesInput } | undefined)?.input;
      return demoListWorkItemTypeStates(input);
    }
    case "list_work_item_fields": {
      const input = (args as { input?: ListWorkItemFieldsInput } | undefined)?.input;
      return demoListWorkItemFields(input);
    }
    case "list_classification_nodes":
      return demoClassificationNodes();
    case "set_work_items_state": {
      const input = (args as { input?: SetWorkItemsStateInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "assign_work_items": {
      const input = (args as { input?: AssignWorkItemsInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "set_work_items_priority": {
      const input = (args as { input?: SetWorkItemsPriorityInput } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "set_work_items_tags": {
      const input = (args as { input?: { workItemIds?: number[] } } | undefined)?.input;
      return (input?.workItemIds ?? []).map((id) => ({ id, error: null }));
    }
    case "list_sync_states":
      return demoSyncStates;
    case "snooze_item": {
      const input = (
        args as { input?: { itemType: string; itemKey: string; snoozeUntil: string } } | undefined
      )?.input;
      if (input) demoSnoozeItem(input.itemType, input.itemKey, input.snoozeUntil);
      return null;
    }
    case "unsnooze_item": {
      const input = (
        args as { input?: { itemType: string; itemKey: string } } | undefined
      )?.input;
      if (input) demoUnsnoozeItem(input.itemType, input.itemKey);
      return null;
    }
    case "list_snoozed_items": {
      const input = (args as { input?: { itemType: string } } | undefined)?.input;
      return demoListSnoozedItems(input?.itemType ?? "");
    }
    case "get_saved_query": {
      const input = (args as { input?: GetSavedQueryInput } | undefined)?.input;
      const queryId = input?.queryId ?? "";
      if (queryId === "00000000-0000-0000-0000-000000000000") {
        return { id: queryId, name: "My Queries (folder)", wiql: null };
      }
      return {
        id: queryId || "demo-query-id",
        name: "Demo Imported Query",
        wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC",
      };
    }
    case "delete_organization":
    case "record_mention_interaction":
    case "record_assignee_interaction":
      return null;
    case "trigger_sync":
      demoSyncStates = demoSyncStates.map((state) => ({
        ...state,
        lastSyncedAt: new Date().toISOString(),
        errorCount: 0,
        lastError: null,
        lastWarning: null,
      }));
      return null;
    default: {
      const ext = dispatchExt(command, args);
      if (ext !== undefined) return ext;
      throw new Error(`Unsupported demo command: ${command}`);
    }
  }
}
