// Pipeline, commit, code-browser, and repo dispatch cases extracted from
// demoInvoke to keep the main file within the 500-line limit.
// Returns `undefined` for unrecognised commands so the caller can fall through.
import type {
  AgentNoteItem,
  CreateAgentNoteInput,
  CommitActivityInput,
  ListNotificationsInput,
  RecordNotificationInput,
  ReplyAgentNoteInput,
  AgentNoteTarget,
  UpdateAgentNoteInput,
  SearchCommitsInput,
} from "@/lib/azdoCommands";
import {
  demoPipelineApprovals,
  demoPipelineDefinitionDetail,
  demoPipelineDefinitions,
  demoPipelineProjects,
  demoPipelineLogTail,
  demoPipelineRunDetail,
  demoPipelineTestResults,
  demoPipelineRuns,
  demoPipelineRunsFiltered,
  demoUpdatePipelineDefinition,
} from "@/lib/demo/pipelines";
import { demoBranchPolicies } from "@/lib/demo/branchPolicies";
import { demoRepoTagOverview } from "@/lib/demo/repoTags";
import { demoGetWikiPage, demoSearchWiki } from "@/lib/demo/wiki";
import {
  demoCommitActivity,
  demoCommitChanges,
  demoCommitPullRequests,
  demoCommitRepositories,
  demoCommits,
  demoGetCodeSearchContext,
  demoBranchOverview,
  demoRepoBranches,
  demoRepoTags,
  demoRevisionComparison,
  demoRepoFile,
  demoRepoHistory,
  demoRepoPaths,
  demoRepoTree,
  demoSearchCode,
} from "@/lib/demo/commits";
import {
  demoListNotifications,
  demoMarkAllNotificationsRead,
  demoMarkNotificationsRead,
  demoRecordNotification,
  demoUnreadNotificationsCount,
} from "@/lib/demo/notifications";
import {
  demoCreateAgentNote,
  demoDeleteAgentNote,
  demoListAgentNotes,
  demoReplyAgentNote,
  demoRestoreAgentNote,
  demoSetAgentNoteStatus,
  demoSubmitAgentNoteDrafts,
  demoSummarizeAgentNotes,
  demoUpdateAgentNote,
} from "@/lib/demo/agentNotes";

export function dispatchExt(command: string, args: unknown): unknown {
  switch (command) {
    // ── Pipelines ──────────────────────────────────────────────────────────
    case "list_pipeline_projects":
      return demoPipelineProjects();
    case "list_pipeline_definitions":
      return demoPipelineDefinitions();
    case "list_pipeline_runs": {
      const input = (
        args as
          | {
              input?: {
                definitionId?: number;
                branch?: string;
                result?: string;
                requestedForMe?: boolean;
              };
            }
          | undefined
      )?.input;
      return demoPipelineRunsFiltered(input);
    }
    case "get_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      return demoPipelineRunDetail(input?.buildId ?? 1001);
    }
    case "list_pipeline_artifacts": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      const buildId = input?.buildId ?? 1001;
      return [
        { name: "drop", downloadUrl: `https://dev.azure.com/contoso/_apis/build/builds/${buildId}/artifacts?artifactName=drop` },
        { name: "test-results", downloadUrl: `https://dev.azure.com/contoso/_apis/build/builds/${buildId}/artifacts?artifactName=test-results` },
      ];
    }
    case "list_pipeline_test_results": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      return demoPipelineTestResults(input?.buildId ?? 1001);
    }
    case "get_pipeline_definition": {
      const input = (args as { input?: { definitionId?: number } } | undefined)?.input;
      return demoPipelineDefinitionDetail(input?.definitionId ?? 1);
    }
    case "update_pipeline_definition": {
      const input = (
        args as {
          input?: {
            definitionId?: number;
            variables?: { name: string; value?: string | null; allowOverride: boolean }[];
            ciTrigger?: { enabled: boolean; branchFilters: string[]; pathFilters: string[] } | null;
          };
        } | undefined
      )?.input;
      return demoUpdatePipelineDefinition(input ?? {});
    }
    case "get_pipeline_run_log_tail": {
      const input = (args as { input?: { logId?: number } } | undefined)?.input;
      return demoPipelineLogTail(input?.logId ?? 7);
    }
    case "rerun_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      return {
        ...demoPipelineRuns()[0],
        buildId: input?.buildId ?? 1004,
        status: "notStarted",
        result: null,
      };
    }
    case "queue_pipeline_run": {
      const input = (args as { input?: { sourceBranch?: string } } | undefined)?.input;
      return {
        ...demoPipelineRuns()[0],
        buildId: 1005,
        status: "notStarted",
        result: null,
        sourceBranch: input?.sourceBranch ?? "refs/heads/main",
      };
    }
    case "cancel_pipeline_run": {
      const input = (args as { input?: { buildId?: number } } | undefined)?.input;
      const run =
        demoPipelineRuns().find((r) => r.buildId === input?.buildId) ??
        demoPipelineRuns()[2];
      return { ...run, status: "cancelling" };
    }
    case "create_pull_request": {
      const input = (args as { input?: { title?: string } } | undefined)?.input;
      return {
        pullRequestId: 9001,
        title: input?.title ?? "New pull request",
        webUrl: "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/9001",
      };
    }
    case "add_pull_request_label": {
      const input = (args as { input?: { name?: string } } | undefined)?.input;
      return { id: `demo-label-${input?.name ?? "new"}`, name: input?.name ?? "" };
    }
    case "retry_pipeline_stage":
      return null;
    case "list_pipeline_approvals":
      return demoPipelineApprovals();
    case "update_pipeline_approval": {
      const input = (
        args as { input?: { approvalId?: string; status?: string } } | undefined
      )?.input;
      const approval =
        demoPipelineApprovals().find((a) => a.id === input?.approvalId) ??
        demoPipelineApprovals()[0];
      return [{ ...approval, status: input?.status ?? "approved" }];
    }
    // ── Commits ────────────────────────────────────────────────────────────
    case "search_commits": {
      const input = (args as { input?: SearchCommitsInput } | undefined)?.input;
      const all = demoCommits(input);
      const offset = input?.offset ?? 0;
      const limit = 100;
      const page = all.slice(offset, offset + limit);
      return { commits: page, total: all.length, truncated: (offset + limit) < all.length };
    }
    case "commit_activity": {
      const input = (args as { input?: CommitActivityInput } | undefined)?.input;
      return demoCommitActivity(input);
    }
    case "list_commit_repositories":
      return demoCommitRepositories();
    case "get_commit_changes": {
      const input = (args as { input?: { commitId?: string } } | undefined)?.input;
      return demoCommitChanges(input?.commitId);
    }
    case "get_commit_file_diff": {
      const input = (args as { input?: { filePath?: string } } | undefined)?.input;
      return {
        filePath: input?.filePath ?? "/src/app.ts",
        baseContent: "const x = 1;\nconst y = 2;\n",
        targetContent: "const x = 1;\nconst y = 3;\nconst z = 4;\n",
        baseUnavailableReason: null,
        targetUnavailableReason: null,
      };
    }
    case "get_commit_pull_requests": {
      const input = (args as { input?: { commitId?: string } } | undefined)?.input;
      return demoCommitPullRequests(input?.commitId);
    }
    case "get_commit_pull_requests_batch": {
      const input = (args as { input?: { commitIds?: string[] } } | undefined)?.input;
      return Object.fromEntries(
        (input?.commitIds ?? []).map((id) => [id, demoCommitPullRequests(id)]),
      );
    }
    case "list_commit_work_items": {
      const input = (args as { input?: { commitId?: string } } | undefined)?.input;
      return input?.commitId?.startsWith("abcdef") ? [1234] : [];
    }
    case "get_commit_containing_refs":
      return { branches: ["main", "release/1.x"], tags: ["v1.1.0"], checked: 5, total: 5 };
    case "cancel_operation":
      // Demo searches resolve instantly, so there is nothing to cancel.
      return null;
    // ── Code / repo browser ────────────────────────────────────────────────
    case "search_code": {
      const input = (args as { input?: { query?: string } } | undefined)?.input;
      return demoSearchCode(input?.query?.trim() ?? "");
    }
    case "search_wiki": {
      const input = (args as { input?: { query?: string } } | undefined)?.input;
      return demoSearchWiki(input?.query?.trim() ?? "");
    }
    case "get_wiki_page": {
      const input = (args as { input?: { pagePath?: string } } | undefined)?.input;
      return demoGetWikiPage(input?.pagePath ?? "/");
    }
    case "get_code_search_context": {
      const input = (args as { input?: { query?: string } } | undefined)?.input;
      return demoGetCodeSearchContext(input?.query?.trim() || "searchCode");
    }
    case "list_repo_branches":
      return demoRepoBranches();
    case "list_repo_branch_overview":
      return demoBranchOverview();
    case "list_branch_policies":
      return demoBranchPolicies();
    case "list_repo_tag_overview":
      return demoRepoTagOverview();
    case "list_repo_tags":
      return demoRepoTags();
    case "compare_repo_revisions":
      return demoRevisionComparison();
    case "list_repo_tree": {
      const input = (
        args as { input?: { path?: string; includeLastCommit?: boolean } } | undefined
      )?.input;
      return demoRepoTree(input?.path, input?.includeLastCommit);
    }
    case "get_repo_file": {
      const input = (args as { input?: { path?: string } } | undefined)?.input;
      return demoRepoFile(input?.path ?? "/README.md");
    }
    case "list_repo_history": {
      const input = (args as { input?: { path?: string } } | undefined)?.input;
      return demoRepoHistory(input?.path ?? "/");
    }
    case "list_repo_paths":
      return demoRepoPaths();
    // ── Notification history ──────────────────────────────────────────────
    case "list_notifications": {
      const input = (args as { input?: ListNotificationsInput } | undefined)?.input;
      return demoListNotifications(input);
    }
    case "get_unread_notifications_count":
      return demoUnreadNotificationsCount();
    case "mark_notifications_read": {
      const input = (args as { input?: { ids?: number[] } } | undefined)?.input;
      demoMarkNotificationsRead(input?.ids ?? []);
      return null;
    }
    case "mark_all_notifications_read":
      demoMarkAllNotificationsRead();
      return null;
    case "record_notification": {
      const input = (args as { input?: RecordNotificationInput } | undefined)?.input;
      if (input) demoRecordNotification(input);
      return null;
    }
    // ── Agent notes ───────────────────────────────────────────────────────
    case "list_agent_notes": {
      const input = (args as { input?: AgentNoteItem } | undefined)?.input;
      return input ? demoListAgentNotes(input) : [];
    }
    case "create_agent_note": {
      const input = (args as { input?: CreateAgentNoteInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoCreateAgentNote(input);
    }
    case "delete_agent_note": {
      const input = (args as { input?: AgentNoteItem & { noteId: string } } | undefined)?.input;
      if (input) demoDeleteAgentNote(input, input.noteId);
      return null;
    }
    case "reply_agent_note": {
      const input = (args as { input?: ReplyAgentNoteInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoReplyAgentNote(input);
    }
    case "update_agent_note": {
      const input = (args as { input?: UpdateAgentNoteInput } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoUpdateAgentNote(input);
    }
    case "set_agent_note_status": {
      const input = (args as { input?: AgentNoteItem & { noteId: string; status: "open" | "done" } } | undefined)?.input;
      if (!input) throw new Error("missing input");
      return demoSetAgentNoteStatus(input);
    }
    case "restore_agent_note": {
      const input = (args as { input?: AgentNoteItem & { noteId: string } } | undefined)?.input;
      if (input) demoRestoreAgentNote(input);
      return null;
    }
    case "submit_agent_note_drafts": {
      const input = (args as { input?: AgentNoteItem } | undefined)?.input;
      return input ? demoSubmitAgentNoteDrafts(input) : 0;
    }
    case "summarize_agent_notes": {
      const input = (args as { input?: { target: AgentNoteTarget } } | undefined)?.input;
      return input ? demoSummarizeAgentNotes(input.target) : [];
    }
    case "run_agent":
      throw new Error("Running an agent is only available in the desktop app");
    default:
      return undefined;
  }
}
