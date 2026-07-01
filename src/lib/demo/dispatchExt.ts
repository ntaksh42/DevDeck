// Pipeline, commit, code-browser, and repo dispatch cases extracted from
// demoInvoke to keep the main file within the 500-line limit.
// Returns `undefined` for unrecognised commands so the caller can fall through.
import type {
  CommitActivityInput,
  SearchCommitsInput,
} from "@/lib/azdoCommands";
import {
  demoPipelineApprovals,
  demoPipelineDefinitionDetail,
  demoPipelineDefinitions,
  demoPipelineProjects,
  demoPipelineRunDetail,
  demoPipelineRuns,
  demoPipelineRunsFiltered,
} from "@/lib/demo/pipelines";
import {
  demoCommitActivity,
  demoCommitPullRequests,
  demoCommitRepositories,
  demoCommits,
  demoGetCodeSearchContext,
  demoRepoBranches,
  demoRepoFile,
  demoRepoHistory,
  demoRepoTree,
  demoSearchCode,
} from "@/lib/demo/commits";
import { demoCommitRefs } from "@/lib/demo/commitRefs";
import { DEMO_PREVIEW_IMAGE_DATA_URL } from "@/lib/demo/settings";

export function dispatchExt(command: string, args: unknown): unknown {
  switch (command) {
    // ── Pipelines ──────────────────────────────────────────────────────────
    case "list_pipeline_projects":
      return demoPipelineProjects();
    case "list_pipeline_definitions":
      return demoPipelineDefinitions();
    case "list_pipeline_runs": {
      const input = (
        args as { input?: { branch?: string; result?: string; requestedForMe?: boolean } } | undefined
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
    case "get_pipeline_definition": {
      const input = (args as { input?: { definitionId?: number } } | undefined)?.input;
      return demoPipelineDefinitionDetail(input?.definitionId ?? 1);
    }
    case "get_pipeline_run_log_tail":
      return {
        lines: ["[command] npm run build", "ERROR: build failed (exit 1)"],
        truncated: false,
      };
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
      const commits = demoCommits(input);
      return { commits, total: commits.length, truncated: false };
    }
    case "commit_activity": {
      const input = (args as { input?: CommitActivityInput } | undefined)?.input;
      return demoCommitActivity(input);
    }
    case "list_commit_repositories":
      return demoCommitRepositories();
    case "get_commit_changes": {
      const input = (args as { input?: { commitId?: string } } | undefined)?.input;
      return {
        commitId: input?.commitId ?? "demosha",
        parentCommitId: "demoparent",
        files: [
          { path: "/src/app.ts", changeType: "edit", originalPath: null },
          { path: "/README.md", changeType: "add", originalPath: null },
        ],
      };
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
    case "get_commit_refs": {
      const input = (args as { input?: { commitId?: string } } | undefined)?.input;
      return demoCommitRefs(input?.commitId);
    }
    case "fetch_commit_avatar":
      return { dataUrl: DEMO_PREVIEW_IMAGE_DATA_URL };
    case "cancel_operation":
      // Demo searches resolve instantly, so there is nothing to cancel.
      return null;
    // ── Code / repo browser ────────────────────────────────────────────────
    case "search_code": {
      const input = (args as { input?: { query?: string } } | undefined)?.input;
      return demoSearchCode(input?.query?.trim() ?? "");
    }
    case "get_code_search_context": {
      const input = (args as { input?: { query?: string } } | undefined)?.input;
      return demoGetCodeSearchContext(input?.query?.trim() || "searchCode");
    }
    case "list_repo_branches":
      return demoRepoBranches();
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
    default:
      return undefined;
  }
}
