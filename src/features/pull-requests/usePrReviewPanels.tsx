import { lazy, Suspense, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  getPullRequestReview,
  prLocator,
  removePullRequestReviewer,
  setPullRequestReviewerRequired,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { focusPrimaryGrid, isEditableTarget } from "@/lib/utils";
import { usePreviewZoom } from "@/lib/usePreviewZoom";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import type { DockablePanelSpec } from "@/components/DockableWorkspace";
import { PrReviewHeader } from "./PrReviewHeader";
import { ReviewTab } from "./PrReviewTabContents";
import { CommitsTab } from "./PrCommitsTab";
import { ResultTab } from "./PrSecondaryTabs";
import { LINKED_WORK_ITEMS_PANEL_ID, LinkedWorkItemsPanel } from "./LinkedWorkItemsPanel";

// The Files tab pulls in the `diff` library, so it is code-split to keep that
// weight out of the startup bundle.
const PrFilesTab = lazy(() =>
  import("./PrFilesTab").then((m) => ({ default: m.PrFilesTab })),
);

/**
 * Builds the PR review tabs (Conversation/Commits/Files changed/Result) as
 * flat `DockablePanelSpec` entries for the caller to place alongside its own
 * results grid in one `DockableWorkspace`.
 *
 * These used to live inside their own nested `DockableWorkspace` rendered as
 * a single "Preview" panel of the caller's grid -- a second dockview
 * instance inside a panel of the first. That nesting was fragile in the
 * desktop app: panel content could collapse to zero height (dockview's
 * `.dv-content-container` isn't itself a flex parent, so a root relying on
 * `flex-1` rather than `h-full` would render blank), and dragging a tab
 * inside the inner instance didn't reliably register. Flattening avoids
 * both -- there is exactly one dockview per screen.
 *
 * `anchor` (Conversation) has no `position`; the caller supplies one
 * (typically split to the right of its grid panel). `secondary` are already
 * positioned `within` the anchor's group as tabs, except the optional linked
 * Work Items pane, which is docked below the caller's `"grid"` panel as its own
 * always-visible group.
 */
export function usePrReviewPanels({
  selectedPr,
  maximized = false,
  onToggleMaximize,
  onOpenLinkedWorkItems,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  /** When set, adds the linked Work Items tab and its header button. */
  onOpenLinkedWorkItems?: () => void;
}): { anchor: DockablePanelSpec; secondary: DockablePanelSpec[] } {
  const { canZoomIn, canZoomOut, resetZoom, zoom, zoomIn, zoomOut } = usePreviewZoom();

  const reviewQuery = useQuery({
    queryKey: [
      "prReview",
      selectedPr?.organizationId,
      selectedPr?.repositoryId,
      selectedPr?.pullRequestId,
    ],
    queryFn: () => getPullRequestReview(prLocator(selectedPr as ReviewPullRequestSummary)),
    enabled: !!selectedPr,
    staleTime: 60_000,
  });

  // Reviewer management lives in the header now, but the mutations belong
  // here (alongside the review query) so the header can stay presentational.
  const queryClient = useQueryClient();
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  function invalidateReviewerData() {
    if (!selectedPr) return;
    void queryClient.invalidateQueries({
      queryKey: ["prReview", selectedPr.organizationId, selectedPr.repositoryId, selectedPr.pullRequestId],
    });
    void queryClient.invalidateQueries({ queryKey: ["myReviews", selectedPr.organizationId] });
  }
  const reviewerRequiredMutation = useMutation({
    mutationFn: setPullRequestReviewerRequired,
    onSuccess: () => {
      setReviewerError(null);
      invalidateReviewerData();
    },
    onError: (error) => setReviewerError(commandErrorMessage(error)),
  });
  const removeReviewerMutation = useMutation({
    mutationFn: removePullRequestReviewer,
    onSuccess: () => {
      setReviewerError(null);
      invalidateReviewerData();
    },
    onError: (error) => setReviewerError(commandErrorMessage(error)),
  });
  const reviewerActionsBusy = reviewerRequiredMutation.isPending || removeReviewerMutation.isPending;

  // Esc / ← step back to the grid from anywhere in the preview that is not a
  // text field (composer Esc is handled locally and stops propagation first).
  function handlePreviewKeyDown(event: React.KeyboardEvent) {
    // Ctrl/Cmd +, -, 0 zoom the preview, matching the buttons' tooltips.
    // Checked before the editable-target bailout below so it also works while
    // a comment editor has focus, same as a browser's own zoom keys.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
    }
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  const noPrSelected = <PreviewEmptyState message="Select a pull request." />;

  // Each tab gets its own copy of the header/error banner/fetching row, since
  // a dockview panel's content is now self-contained (the tab may end up
  // split into its own pane, visible alongside another tab rather than
  // switched with it). Only the active tab actually renders at a time by
  // default, so this costs nothing until the user splits them apart.
  function withChrome(body: ReactNode) {
    return (
      <aside
        onKeyDown={handlePreviewKeyDown}
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring"
      >
        <PrReviewHeader
          selectedPr={selectedPr}
          review={reviewQuery.data ?? null}
          maximized={maximized}
          onToggleMaximize={onToggleMaximize}
          onOpenLinkedWorkItems={onOpenLinkedWorkItems}
          reviewerActionsBusy={reviewerActionsBusy}
          onToggleReviewerRequired={(reviewer) => {
            if (!selectedPr || !reviewer.id) return;
            reviewerRequiredMutation.mutate({
              ...prLocator(selectedPr),
              reviewerId: reviewer.id,
              isRequired: !reviewer.isRequired,
            });
          }}
          onRemoveReviewer={(reviewer) => {
            if (!selectedPr || !reviewer.id) return;
            if (window.confirm(`Remove ${reviewer.displayName} as a reviewer?`)) {
              removeReviewerMutation.mutate({ ...prLocator(selectedPr), reviewerId: reviewer.id });
            }
          }}
          zoom={zoom}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
        />
        {reviewerError ? (
          <div className="shrink-0 border-b border-border bg-red-50 px-3 py-1 text-xs text-destructive dark:bg-red-950/40">
            {reviewerError}
          </div>
        ) : null}
        {reviewQuery.isFetching ? (
          <div className="flex h-6 shrink-0 items-center justify-end gap-2 border-b border-border px-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto" style={{ zoom }}>
          {body}
        </div>
      </aside>
    );
  }

  const anchor: DockablePanelSpec = {
    id: "review",
    title: "Conversation",
    content: withChrome(
      !selectedPr ? (
        noPrSelected
      ) : (
        <ReviewTab
          pr={selectedPr}
          review={reviewQuery.data ?? null}
          loading={reviewQuery.isLoading}
          error={reviewQuery.isError ? commandErrorMessage(reviewQuery.error) : null}
        />
      ),
    ),
  };

  // Result stays included even without a configured folder since ResultTab
  // renders its own "not configured" empty state.
  const secondary: DockablePanelSpec[] = [
    {
      id: "commits",
      title: "Commits",
      content: withChrome(!selectedPr ? noPrSelected : <CommitsTab pr={selectedPr} />),
      position: { relativeTo: "review", direction: "within" },
    },
    {
      id: "files",
      title: "Files changed",
      content: withChrome(
        !selectedPr ? (
          noPrSelected
        ) : (
          <Suspense fallback={<LoadingState />}>
            <PrFilesTab pr={selectedPr} threads={reviewQuery.data?.threads} />
          </Suspense>
        ),
      ),
      position: { relativeTo: "review", direction: "within" },
    },
    {
      id: "result",
      title: "Result",
      content: withChrome(!selectedPr ? noPrSelected : <ResultTab selectedPr={selectedPr} />),
      position: { relativeTo: "review", direction: "within" },
    },
    ...(onOpenLinkedWorkItems
      ? [
          {
            id: LINKED_WORK_ITEMS_PANEL_ID,
            title: "Work Items",
            // No PR header/zoom chrome: the PR header in the Conversation pane
            // already covers it. Docked below the caller's "grid" panel (not
            // below "review") so the Conversation group stays a direct child
            // of the horizontal split and keeps its width resize handle.
            content: !selectedPr ? noPrSelected : <LinkedWorkItemsPanel pr={selectedPr} />,
            position: { relativeTo: "grid", direction: "below" },
            initialHeight: 400,
            minHeight: 140,
          } satisfies DockablePanelSpec,
        ]
      : []),
  ];

  return { anchor, secondary };
}
