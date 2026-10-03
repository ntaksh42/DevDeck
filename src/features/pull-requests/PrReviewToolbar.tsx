import { ClipboardList, Maximize2, Minimize2, Share2 } from "lucide-react";
import { openMailtoUrl } from "@/lib/openExternal";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { PreviewZoomControls } from "@/components/PreviewZoomControls";
import { buildPullRequestEmailLink } from "./prEmailLink";

const ICON_BUTTON_CLASS =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

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
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <PreviewZoomControls
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        zoom={zoom}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={onResetZoom}
      />
      {selectedPr ? (
        <button
          type="button"
          onClick={() =>
            void openMailtoUrl(
              buildPullRequestEmailLink({
                pullRequestId: selectedPr.pullRequestId,
                title: title ?? selectedPr.title,
                webUrl: selectedPr.webUrl,
              }),
            )
          }
          aria-label="Email a link"
          title="Email a link"
          className={ICON_BUTTON_CLASS}
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {selectedPr && onOpenLinkedWorkItems ? (
        <button
          type="button"
          onClick={onOpenLinkedWorkItems}
          aria-label="Preview linked work items"
          title="Preview linked work items (T)"
          className={ICON_BUTTON_CLASS}
        >
          <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {onToggleMaximize ? (
        <button
          type="button"
          onClick={onToggleMaximize}
          aria-label={maximized ? "Restore split view" : "Maximize review panel"}
          aria-pressed={maximized}
          title={`${maximized ? "Restore split view" : "Maximize review panel"} (\\)`}
          className={ICON_BUTTON_CLASS}
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}
