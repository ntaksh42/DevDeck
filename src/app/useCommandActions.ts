import type { CommandPaletteAction } from "@/components/CommandPalette";
import type { QuickPipeline } from "@/features/pipelines/quickPipelinesStorage";
import {
  focusWorkItemCommentInput,
  focusFilterInput,
  focusPrimaryGrid,
  focusPrimaryPreview,
} from "@/lib/utils";
import { resetLayoutWidths } from "@/lib/layoutReset";
import { dispatchWorkItemCommand } from "./appHelpers";
import type { View } from "./types";

export interface UseCommandActionsParams {
  activeView: View;
  organizationsLength: number;
  syncPending: boolean;
  readOnlyMode: boolean;
  quickPipelines: QuickPipeline[];
  setView: (view: View) => void;
  syncAll: () => void;
  refreshCurrentView: () => void;
  runQuickPipeline: (pipeline: QuickPipeline) => void;
  openHelp: () => void;
}

export function useCommandActions({
  activeView,
  organizationsLength,
  syncPending,
  readOnlyMode,
  quickPipelines,
  setView,
  syncAll,
  refreshCurrentView,
  runQuickPipeline,
  openHelp,
}: UseCommandActionsParams): CommandPaletteAction[] {
  const isWorkItemView =
    activeView === "myWorkItems" ||
    activeView === "workItems" ||
    activeView === "workItemViews";

  return [
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.myReviews",
      keywords: ["pull request", "review"],
      label: "Go to My Reviews",
      run: () => setView("myReviews"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.pullRequestSearch",
      keywords: ["pull request", "search"],
      label: "Go to Pull Request Search",
      run: () => setView("pullRequestSearch"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.myWorkItems",
      keywords: ["work item", "assigned"],
      label: "Go to My Work Items",
      run: () => setView("myWorkItems"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.workItemViews",
      keywords: ["wiql", "query", "saved"],
      label: "Go to Work Item Views",
      run: () => setView("workItemViews"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.workItemSearch",
      keywords: ["work item", "search"],
      label: "Go to Work Item Search",
      run: () => setView("workItems"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.commits",
      keywords: ["commit", "search"],
      label: "Go to Commits",
      run: () => setView("commits"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.pipelines",
      keywords: ["build", "ci", "pipeline"],
      label: "Go to Pipelines",
      run: () => setView("pipelines"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.codeSearch",
      keywords: ["code", "files", "browse", "repository", "search", "grep"],
      label: "Go to Code Files",
      run: () => setView("codeSearch"),
    },
    {
      disabled: organizationsLength === 0,
      group: "Navigation",
      id: "nav.wiki",
      keywords: ["wiki", "docs", "documentation", "page"],
      label: "Go to Wiki",
      run: () => setView("wiki"),
    },
    {
      group: "Navigation",
      id: "nav.settings",
      keywords: ["option", "preferences"],
      label: "Go to Settings",
      run: () => setView("settings"),
      shortcut: "Ctrl+,",
    },
    {
      group: "Focus",
      id: "focus.filter",
      keywords: ["search", "find"],
      label: "Focus filter",
      run: () => {
        focusFilterInput();
      },
      shortcut: "Ctrl+F",
    },
    {
      group: "Focus",
      id: "focus.grid",
      keywords: ["list", "table", "rows"],
      label: "Focus grid",
      run: focusPrimaryGrid,
      shortcut: "Ctrl+G",
    },
    {
      group: "Focus",
      id: "focus.preview",
      keywords: ["details", "pane"],
      label: "Focus preview",
      run: focusPrimaryPreview,
      shortcut: "Ctrl+P",
    },
    {
      group: "Focus",
      id: "focus.comment",
      keywords: ["work item", "discussion"],
      label: "Focus work item comment",
      run: () => {
        if (!focusWorkItemCommentInput()) dispatchWorkItemCommand("focus-comment");
      },
      shortcut: "M",
    },
    {
      disabled: !isWorkItemView,
      group: "Work Items",
      id: "wi.state",
      keywords: ["status", "transition"],
      label: "Change selected work item state",
      run: () => dispatchWorkItemCommand("open-state"),
      shortcut: "S",
    },
    {
      disabled: !isWorkItemView,
      group: "Work Items",
      id: "wi.assignee",
      keywords: ["assign", "owner"],
      label: "Change selected work item assignee",
      run: () => dispatchWorkItemCommand("open-assignee"),
      shortcut: "A",
    },
    {
      disabled: !isWorkItemView,
      group: "Work Items",
      id: "wi.priority",
      keywords: ["prio"],
      label: "Change selected work item priority",
      run: () => dispatchWorkItemCommand("open-priority"),
      shortcut: "P",
    },
    {
      disabled: !isWorkItemView,
      group: "Work Items",
      id: "wi.customField",
      keywords: ["custom", "field", "edit"],
      label: "Change selected work item custom field",
      run: () => dispatchWorkItemCommand("open-field"),
      shortcut: "F",
    },
    {
      disabled: !isWorkItemView,
      group: "Work Items",
      id: "wi.postComment",
      keywords: ["submit", "discussion"],
      label: "Post work item comment",
      run: () => dispatchWorkItemCommand("post-comment"),
      shortcut: "Ctrl+Enter",
    },
    {
      disabled: !isWorkItemView,
      group: "Work Items",
      id: "wi.applyStaged",
      keywords: ["save", "pending", "apply"],
      label: "Apply pending work item changes",
      run: () => dispatchWorkItemCommand("apply-staged"),
      shortcut: "Ctrl+S",
    },
    {
      disabled: organizationsLength === 0 || syncPending,
      group: "General",
      id: "general.sync",
      keywords: ["refresh"],
      label: "Sync now",
      run: syncAll,
      shortcut: "Ctrl+E",
    },
    {
      disabled: organizationsLength === 0 || syncPending,
      group: "General",
      id: "general.refreshCurrentView",
      keywords: ["refresh", "current", "sync"],
      label: "Refresh current view",
      run: refreshCurrentView,
      shortcut: "Ctrl+R",
    },
    {
      group: "General",
      id: "general.shortcuts",
      keywords: ["keyboard", "help"],
      label: "Show keyboard shortcuts",
      run: () => openHelp(),
      shortcut: "?",
    },
    {
      group: "General",
      id: "general.resetLayoutWidths",
      keywords: ["layout", "width", "sidebar", "preview", "column", "reset", "default"],
      label: "Reset layout widths",
      run: resetLayoutWidths,
    },
    ...quickPipelines.map<CommandPaletteAction>((pipeline) => ({
      disabled: readOnlyMode,
      group: "Pipelines",
      id: `pipeline.run.${pipeline.id}`,
      keywords: ["pipeline", "build", "run", "trigger", pipeline.definitionName],
      label: readOnlyMode
        ? `Run: ${pipeline.name} (read-only)`
        : `Run: ${pipeline.name}`,
      run: () => {
        runQuickPipeline(pipeline);
      },
    })),
  ];
}
