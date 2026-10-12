import { Suspense } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { commandErrorMessage, type Organization } from "@/lib/azdoCommands";
import { LoadingState, ErrorState } from "@/components/StateDisplay";
import { handlePaneFocusKey } from "@/lib/paneFocus";
import { MyReviewsGrid } from "@/features/pull-requests/MyReviewsGrid";
import type { MyReviewsSelectRequest } from "@/features/pull-requests/MyReviewsGrid";
import type { WorkItemQueryView } from "@/features/work-items/workItemViewsStorage";
import {
  PipelinesView,
  WorkItemSearch,
  WorkItemViewsPanel,
  MyWorkItemsPanel,
  OrganizationSettings,
  SetupPanel,
  PullRequestSearch,
  MyPullRequestsGrid,
  AnalyzeView,
  CrossOrgSummaryView,
  NotificationsView,
  InboxView,
} from "./lazyViews";
import type { View, ExternalSearchRequest } from "./types";

export interface AppContentProps {
  activeView: View;
  organizations: Organization[];
  organizationsQuery: Pick<UseQueryResult, "isLoading" | "isError" | "error" | "refetch">;
  pullRequestSearchRequest: ExternalSearchRequest | null;
  workItemSearchRequest: ExternalSearchRequest | null;
  myReviewsSelectRequest: MyReviewsSelectRequest | null;
  selectedWorkItemViewRequestId: string | null;
  onPullRequestSearchHandled: () => void;
  onWorkItemSearchHandled: () => void;
  onMyReviewsSelectHandled: () => void;
  onSelectedViewChange: (id: string | null) => void;
  onSelectedViewRequestHandled: () => void;
  onWorkItemNavViewsChange: (views: WorkItemQueryView[]) => void;
  onOpenSettings: () => void;
  onOpenPullRequest: (query: string, organizationId?: string) => void;
  onOpenView: (view: "pipelines" | "settings" | "myReviews" | "myWorkItems") => void;
}

export function AppContent({
  activeView,
  organizations,
  organizationsQuery,
  pullRequestSearchRequest,
  workItemSearchRequest,
  myReviewsSelectRequest,
  selectedWorkItemViewRequestId,
  onPullRequestSearchHandled,
  onWorkItemSearchHandled,
  onMyReviewsSelectHandled,
  onSelectedViewChange,
  onSelectedViewRequestHandled,
  onWorkItemNavViewsChange,
  onOpenSettings,
  onOpenPullRequest,
  onOpenView,
}: AppContentProps) {
  return (
    <section
      data-focus-pane="view"
      tabIndex={-1}
      onKeyDownCapture={handlePaneFocusKey}
      className={`flex min-h-0 flex-1 flex-col px-3 py-3 lg:px-5 outline-none ${
        activeView === "settings" || organizations.length === 0
          ? "overflow-auto"
          : "overflow-hidden"
      }`}
    >
      <Suspense fallback={<LoadingState />}>
        {organizationsQuery.isLoading ? (
          <LoadingState />
        ) : organizationsQuery.isError ? (
          <ErrorState
            message={commandErrorMessage(organizationsQuery.error)}
            onRetry={() => void organizationsQuery.refetch()}
            onOpenSettings={onOpenSettings}
          />
        ) : activeView === "pullRequestSearch" ? (
          <PullRequestSearch
            externalSearch={pullRequestSearchRequest}
            onExternalSearchHandled={onPullRequestSearchHandled}
          />
        ) : activeView === "myReviews" ? (
          <MyReviewsGrid
            selectRequest={myReviewsSelectRequest}
            onSelectRequestHandled={onMyReviewsSelectHandled}
          />
        ) : activeView === "myPullRequests" ? (
          <MyPullRequestsGrid />
        ) : activeView === "workItems" ? (
          <WorkItemSearch
            externalSearch={workItemSearchRequest}
            onExternalSearchHandled={onWorkItemSearchHandled}
          />
        ) : activeView === "myWorkItems" ? (
          <MyWorkItemsPanel />
        ) : activeView === "workItemViews" ? (
          <WorkItemViewsPanel
            selectedViewRequestId={selectedWorkItemViewRequestId}
            onSelectedViewChange={onSelectedViewChange}
            onSelectedViewRequestHandled={onSelectedViewRequestHandled}
            onViewsChange={onWorkItemNavViewsChange}
          />
        ) : activeView === "pipelines" ? (
          <PipelinesView />
        ) : activeView === "inbox" ? (
          <InboxView onOpenView={onOpenView} />
        ) : activeView === "notifications" ? (
          <NotificationsView onOpenPullRequest={onOpenPullRequest} onOpenView={onOpenView} />
        ) : activeView === "crossOrgSummary" ? (
          <CrossOrgSummaryView onOpenView={onOpenView} />
        ) : activeView === "analyze" ? (
          <AnalyzeView />
        ) : organizations.length === 0 ? (
          <SetupPanel />
        ) : (
          <OrganizationSettings organizations={organizations} />
        )}
      </Suspense>
    </section>
  );
}
