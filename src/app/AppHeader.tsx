import { PanelLeft, PanelLeftClose } from "lucide-react";
import type { KeybindingMap } from "@/lib/keybindings";
import { SyncStatusIndicator } from "@/features/sync/SyncStatusIndicator";
import type { View } from "./types";

const VIEW_TITLES: Record<View, string> = {
  pullRequestSearch: "Pull Requests",
  myReviews: "My Reviews",
  myPullRequests: "My Pull Requests",
  workItems: "Work Items",
  myWorkItems: "My Work Items",
  workItemViews: "Work Item Views",
  commits: "Commits",
  pipelines: "Pipelines",
  codeSearch: "Code",
  settings: "Settings",
};

const VIEW_DESCRIPTIONS: Record<View, string> = {
  pullRequestSearch: "Search Azure DevOps pull requests across projects and repositories",
  myReviews: "Pull requests assigned to you for review",
  myPullRequests: "Active pull requests you authored",
  workItems: "Search Azure DevOps work items across projects",
  myWorkItems: "Work items assigned to you",
  workItemViews: "Saved WIQL views with counts, grid results, and preview",
  commits: "Search Azure DevOps commits across repositories",
  pipelines: "Azure DevOps build runs by project",
  codeSearch: "Browse repository files and search code",
  settings: "Local Azure DevOps organization setup",
};

export interface AppHeaderProps {
  activeView: View;
  sidebarCollapsed: boolean;
  organizationsLength: number;
  keybindings: KeybindingMap;
  syncing: boolean;
  onToggleSidebar: () => void;
  onSync: () => void;
}

export function AppHeader({
  activeView,
  sidebarCollapsed,
  organizationsLength,
  keybindings,
  syncing,
  onToggleSidebar,
  onSync,
}: AppHeaderProps) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4 lg:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? "Expand left navigation" : "Collapse left navigation"}
          aria-keyshortcuts={keybindings.toggleSidebar}
          title={`${sidebarCollapsed ? "Expand" : "Collapse"} navigation (${keybindings.toggleSidebar})`}
          className="hidden shrink-0 rounded-md p-1.5 text-muted-foreground outline-none hover:bg-secondary focus:ring-2 focus:ring-ring lg:flex"
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{VIEW_TITLES[activeView]}</h1>
          <p className="text-sm text-muted-foreground">{VIEW_DESCRIPTIONS[activeView]}</p>
        </div>
      </div>
      {organizationsLength > 0 && (
        <div className="flex items-center gap-2">
          <SyncStatusIndicator onSync={onSync} syncing={syncing} />
        </div>
      )}
    </header>
  );
}
