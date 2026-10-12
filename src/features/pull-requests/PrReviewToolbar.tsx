import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { openMailtoUrl } from "@/lib/openExternal";
import { PreviewToolbar } from "@/components/PreviewToolbar";
import { buildPullRequestEmailLink } from "./prEmailLink";

// View controls for the PR review tabs. Rendered in the dock tab strip (the
// panels' `headerActions`) rather than in the PR header, so the title can sit
// at the top of the pane instead of under a row of icons.
export function PrReviewToolbar({
  selectedPr,
  title,
  maximized,
  onToggleMaximize,
  onOpenLinkedWorkItems,
  zoom,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: {
  selectedPr: ReviewPullRequestSummary | null;
  title: string | null;
  maximized: boolean;
  onToggleMaximize?: () => void;
  onOpenLinkedWorkItems?: () => void;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}) {
  function emailLink() {
    if (!selectedPr) return;
    void openMailtoUrl(
      buildPullRequestEmailLink({
        pullRequestId: selectedPr.pullRequestId,
        title: title ?? selectedPr.title,
        webUrl: selectedPr.webUrl,
      }),
    );
  }

  return (
    <PreviewToolbar
      zoom={{ zoom, canZoomIn, canZoomOut, onZoomIn, onZoomOut, onResetZoom }}
      maximize={
        onToggleMaximize
          ? { maximized, onToggle: onToggleMaximize, label: "Maximize review panel" }
          : undefined
      }
      items={[
        ...(selectedPr ? [{ label: "Email a link", onSelect: emailLink }] : []),
        ...(selectedPr && onOpenLinkedWorkItems
          ? [{ label: "Preview linked work items", onSelect: onOpenLinkedWorkItems, hint: "T" }]
          : []),
      ]}
    />
  );
}
