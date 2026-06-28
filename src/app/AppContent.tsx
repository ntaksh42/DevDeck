import { Suspense } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { commandErrorMessage, type Organization } from "@/lib/azdoCommands";
import { LoadingState, ErrorState } from "@/components/StateDisplay";
import { MyReviewsGrid } from "@/features/pull-requests/MyReviewsGrid";
import type { MyReviewsSelectRequest } from "@/features/pull-requests/MyReviewsGrid";
import type { WorkItemQueryView } from "@/features/work-items/workItemViewsStorage";
import {
  CommitSearch,
  PipelinesView,
  CodeBrowseView,
  WorkItemSearch,
  WorkItemViewsPanel,
  MyWorkItemsPanel,
  OrganizationSettings,
  SetupPanel,
  PullRequestSearch,
  MyPullRequestsGrid,
} from "./lazyViews";
import type { View, ExternalSearchRequest } from "./types";

export interface AppContentProps {
  activeView: View;
  organizations: Organization[];
  organizationsQuery: Pick<UseQueryResult, "isLoading" | "isError" | "error" | "refetch">;
  pullRequestSearchRequest: ExternalSearchRequest | null;
  workItemSearchRequest: ExternalSearchRequest | null;
  commitSearchRequest: ExternalSearchRequest | null;
  myReviewsSelectRequest: MyReviewsSelectRequest | null;
  selectedWorkItemViewRequestId: string | null;
  onPullRequestSearchHandled: () => void;
  onWorkItemSearchHandled: () => void;
  onCommitSearchHandled: () => void;
  onMyReviewsSelectHandled: () => void;
  onSelectedViewChange: (id: string | null) => void;
  onSelectedViewRequestHandled: () => void;
  onWorkItemNavViewsChange: (views: WorkItemQueryView[]) => void;
  onOpenSettings: () => void;
  onOpenPullRequest: (query: string, organizationId?: string) => void;
}

export function AppContent({
  activeView,
  organizations,
  organizationsQuery,
  pullRequestSearchRequest,
  workItemSearchRequest,
  commitSearchRequest,
  myReviewsSelectRequest,
  selectedWorkItemViewRequestId,
  onPullRequestSearchHandled,
  onWorkItemSearchHandled,
  onCommitSearchHandled,
  onMyReviewsSelectHandled,
  onSelectedViewChange,
  onSelectedViewRequestHandled,
  onWorkItemNavViewsChange,
  onOpenSettings,
  onOpenPullRequest,
}: AppContentProps) {
  return (
    <section
      className={`flex min-h-0 flex-1 flex-col px-3 py-3 lg:px-5 ${
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
            organizations={organizations}
            externalSearch={pullRequestSearchRequest}
            onExternalSearchHandled={onPullRequestSearchHandled}
          />
        ) : activeView === "myReviews" ? (
          <MyReviewsGrid
            organizations={organizations}
            selectRequest={myReviewsSelectRequest}
            onSelectRequestHandled={onMyReviewsSelectHandled}
          />
        ) : activeView === "myPullRequests" ? (
          <MyPullRequestsGrid organizations={organizations} />
        ) : activeView === "workItems" ? (
          <WorkItemSearch
            organizations={organizations}
            externalSearch={workItemSearchRequest}
            onExternalSearchHandled={onWorkItemSearchHandled}
          />
        ) : activeView === "myWorkItems" ? (
          <MyWorkItemsPanel organizations={organizations} />
        ) : activeView === "workItemViews" ? (
          <WorkItemViewsPanel
            organizations={organizations}
            selectedViewRequestId={selectedWorkItemViewRequestId}
            onSelectedViewChange={onSelectedViewChange}
            onSelectedViewRequestHandled={onSelectedViewRequestHandled}
            onViewsChange={onWorkItemNavViewsChange}
          />
        ) : activeView === "commits" ? (
          <CommitSearch
            organizations={organizations}
            externalSearch={commitSearchRequest}
            onExternalSearchHandled={onCommitSearchHandled}
            onOpenPullRequest={onOpenPullRequest}
          />
        ) : activeView === "pipelines" ? (
          <PipelinesView organizations={organizations} />
        ) : activeView === "codeSearch" ? (
          <CodeBrowseView organizations={organizations} />
        ) : organizations.length === 0 ? (
          <SetupPanel />
        ) : (
          <OrganizationSettings organizations={organizations} />
        )}
      </Suspense>
    </section>
  );
}
