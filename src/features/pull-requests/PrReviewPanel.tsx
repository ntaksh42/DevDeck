import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  getPullRequestReview,
  prLocator,
  removePullRequestReviewer,
  setPullRequestReviewerRequired,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { focusPrimaryGrid, isEditableTarget } from "@/lib/utils";
import { LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { PrReviewHeader } from "./PrReviewHeader";
import { ReviewTab } from "./PrReviewTabContents";
import { CommitsTab } from "./PrCommitsTab";
import { ResultTab } from "./PrSecondaryTabs";

// The Files tab is not the default tab and pulls in the `diff` library, so it
// is code-split to keep that weight out of the startup bundle.
const PrFilesTab = lazy(() =>
  import("./PrFilesTab").then((m) => ({ default: m.PrFilesTab })),
);

type PanelTab = "review" | "files" | "commits" | "result";

// Order/labels mirror GitHub's PR tabs (Conversation, Commits, Files changed).
const PANEL_TABS: { key: PanelTab; label: string }[] = [
  { key: "review", label: "Conversation" },
  { key: "commits", label: "Commits" },
  { key: "files", label: "Files changed" },
  { key: "result", label: "Result" },
];

export function PrReviewPanel({
  selectedPr,
  maximized = false,
  onToggleMaximize,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  maximized?: boolean;
  onToggleMaximize?: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>("review");

  const reviewQuery = useQuery({
    queryKey: [
      "prReview",
      selectedPr?.organizationId,
      selectedPr?.repositoryId,
      selectedPr?.pullRequestId,
    ],
    queryFn: () => getPullRequestReview(prLocator(selectedPr as ReviewPullRequestSummary)),
    enabled: !!selectedPr && (tab === "review" || tab === "files"),
    staleTime: 60_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  // The Result tab only surfaces a local HTML folder, so hide it until one is
  // configured instead of showing an empty "not configured" tab.
  const hasReviewResultFolder = !!settingsQuery.data?.reviewResultFolderPath;
  const tabs = hasReviewResultFolder
    ? PANEL_TABS
    : PANEL_TABS.filter((option) => option.key !== "result");

  useEffect(() => {
    if (!hasReviewResultFolder && tab === "result") setTab("review");
  }, [hasReviewResultFolder, tab]);

  // Reviewer management lives in the header now, but the mutations belong to the
  // panel (which owns the review query) so the header can stay presentational.
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
    if (isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusPrimaryGrid();
    }
  }

  return (
    <aside
      onKeyDown={handlePreviewKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring"
    >
      {/* Persistent PR header (visible on every tab), GitHub-style. Reviewers
          (with required/optional + remove controls) render here too. */}
      <PrReviewHeader
        selectedPr={selectedPr}
        review={reviewQuery.data ?? null}
        maximized={maximized}
        onToggleMaximize={onToggleMaximize}
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
      />
      {reviewerError ? (
        <div className="shrink-0 border-b border-border bg-red-50 px-3 py-1 text-xs text-destructive dark:bg-red-950/40">
          {reviewerError}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5" role="tablist" aria-label="PR review tabs">
          {tabs.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              onClick={() => setTab(option.key)}
              className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${
                tab === option.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {reviewQuery.isFetching && tab !== "result" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>
      </div>

      {!selectedPr ? (
        <PreviewEmptyState message="Select a pull request." />
      ) : tab === "review" ? (
        <ReviewTab
          pr={selectedPr}
          review={reviewQuery.data ?? null}
          loading={reviewQuery.isLoading}
          error={reviewQuery.isError ? commandErrorMessage(reviewQuery.error) : null}
        />
      ) : tab === "files" ? (
        <Suspense fallback={<LoadingState />}>
          <PrFilesTab pr={selectedPr} threads={reviewQuery.data?.threads} />
        </Suspense>
      ) : tab === "commits" ? (
        <CommitsTab pr={selectedPr} />
      ) : (
        <ResultTab selectedPr={selectedPr} />
      )}
    </aside>
  );
}
