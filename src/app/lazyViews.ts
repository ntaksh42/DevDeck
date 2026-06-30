import { lazy } from "react";

// Only the default view (My Reviews) loads eagerly; the other views are
// code-split so app startup does not pay for panels that may never open.
export const CommitSearch = lazy(() =>
  import("@/features/commits/CommitSearch").then((m) => ({ default: m.CommitSearch })),
);
export const PipelinesView = lazy(() =>
  import("@/features/pipelines/PipelinesView").then((m) => ({ default: m.PipelinesView })),
);
export const CodeBrowseView = lazy(() =>
  import("@/features/code/CodeBrowseView").then((m) => ({ default: m.CodeBrowseView })),
);
export const WikiView = lazy(() =>
  import("@/features/wiki/WikiView").then((m) => ({ default: m.WikiView })),
);
export const WorkItemSearch = lazy(() =>
  import("@/features/work-items/WorkItemSearch").then((m) => ({ default: m.WorkItemSearch })),
);
export const WorkItemViewsPanel = lazy(() =>
  import("@/features/work-items/WorkItemViewsPanel").then((m) => ({
    default: m.WorkItemViewsPanel,
  })),
);
export const MyWorkItemsPanel = lazy(() =>
  import("@/features/work-items/MyWorkItemsPanel").then((m) => ({
    default: m.MyWorkItemsPanel,
  })),
);
export const OrganizationSettings = lazy(() =>
  import("@/features/settings/OrganizationSettings").then((m) => ({
    default: m.OrganizationSettings,
  })),
);
export const SetupPanel = lazy(() =>
  import("@/features/settings/OrganizationSettings").then((m) => ({ default: m.SetupPanel })),
);
export const PullRequestSearch = lazy(() =>
  import("@/features/pull-requests/PullRequestSearch").then((m) => ({
    default: m.PullRequestSearch,
  })),
);
export const MyPullRequestsGrid = lazy(() =>
  import("@/features/pull-requests/MyPullRequestsGrid").then((m) => ({
    default: m.MyPullRequestsGrid,
  })),
);
