import { ChevronRight, PanelLeft, PanelLeftClose } from "lucide-react";
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
  pipelines: "Pipelines",
  notifications: "Notifications",
  crossOrgSummary: "Cross-organization summary",
  analyze: "Analyze",
  settings: "Settings",
};

// Breadcrumb path for views nested under a nav section, so the header names
// both the section and the active screen (e.g. "Work Items › Search") instead
// of just one or the other. Top-level views (Pipelines, Analyze, Notifications,
// Settings, ...) are left out and keep a single-segment title.
const VIEW_BREADCRUMBS: Partial<Record<View, readonly [string, string]>> = {
  pullRequestSearch: ["Pull Requests", "Search"],
  myReviews: ["Pull Requests", "My Reviews"],
  myPullRequests: ["Pull Requests", "My Pull Requests"],
  workItems: ["Work Items", "Search"],
  myWorkItems: ["Work Items", "My Items"],
  workItemViews: ["Work Items", "Views"],
};

const VIEW_DESCRIPTIONS: Record<View, string> = {
  pullRequestSearch: "Search Azure DevOps pull requests across projects and repositories",
  myReviews: "Pull requests assigned to you for review",
  myPullRequests: "Active pull requests you authored",
  workItems: "Search Azure DevOps work items across projects",
  myWorkItems: "Work items assigned to you",
  workItemViews: "Saved WIQL views with counts, grid results, and preview",
  pipelines: "Azure DevOps build runs by project",
  notifications: "History of review requests, work item updates, and pipeline alerts",
  crossOrgSummary: "Reviews and work items totalled across every connection",
  analyze: "Query count trends for a group, by day or week",
  settings: "Local Azure DevOps organization setup",
};

export interface AppHeaderProps {
  activeView: View;
  sidebarCollapsed: boolean;
  organizationsLength: number;
  keybindings: KeybindingMap;
  syncing: boolean;
  /** Name of the currently selected saved work item view, when on the Views screen. */
  activeWorkItemViewName?: string | null;
  onToggleSidebar: () => void;
  onSync: () => void;
}

export function AppHeader({
  activeView,
  sidebarCollapsed,
  organizationsLength,
  keybindings,
  syncing,
  activeWorkItemViewName,
  onToggleSidebar,
  onSync,
}: AppHeaderProps) {
  const breadcrumb = VIEW_BREADCRUMBS[activeView];
  const segments: string[] = breadcrumb
    ? activeView === "workItemViews" && activeWorkItemViewName
      ? [...breadcrumb, activeWorkItemViewName]
      : [...breadcrumb]
    : [VIEW_TITLES[activeView]];

  return (
    <header className="flex h-9 items-center justify-between border-b border-border bg-card px-4 lg:px-5">
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
        {/* One line: the description is a tooltip so the header gives its height back to the view.
            The visible breadcrumb is decorative (aria-hidden) so screen readers get a single,
            reliably space-separated name from aria-label instead of concatenated child text. */}
        <h1
          className="flex min-w-0 items-center gap-1 text-base font-semibold"
          title={VIEW_DESCRIPTIONS[activeView]}
          aria-label={segments.join(" ")}
        >
          <span aria-hidden="true" className="flex min-w-0 items-center gap-1">
            {segments.map((segment, index) => {
              const isLast = index === segments.length - 1;
              return (
                <span key={index} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? (
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={
                      isLast ? "truncate" : "shrink-0 font-normal text-muted-foreground"
                    }
                  >
                    {segment}
                  </span>
                </span>
              );
            })}
          </span>
        </h1>
      </div>
      {organizationsLength > 0 && (
        <div className="flex items-center gap-2">
          <SyncStatusIndicator onSync={onSync} syncing={syncing} />
        </div>
      )}
    </header>
  );
}
