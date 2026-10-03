import { useLayoutEffect, useRef, useState } from "react";
import { ClipboardList, Maximize2, Minimize2, Share2 } from "lucide-react";
import { openMailtoUrl } from "@/lib/openExternal";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { PreviewZoomControls } from "@/components/PreviewZoomControls";
import { buildPullRequestEmailLink } from "./prEmailLink";
import { PrReviewToolbarMenu } from "./PrReviewToolbarMenu";

const ICON_BUTTON_CLASS =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// Width the full icon row needs before its first measurement (zoom group +
// three icons, with gaps); replaced by the measured width once rendered.
const FULL_TOOLBAR_FALLBACK_WIDTH = 160;

/**
 * True when the dock tab strip holding `root` can't fit every tab and the full
 * toolbar side by side. Compares against the full toolbar's width (measured
 * while it is shown) rather than checking for overflow, so folding the icons
 * into the menu doesn't flip the result back on the next layout.
 */
function useNarrowTabStrip(root: React.RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  const fullWidth = useRef(FULL_TOOLBAR_FALLBACK_WIDTH);

  useLayoutEffect(() => {
    const strip = root.current?.closest<HTMLElement>(".dv-tabs-and-actions-container");
    const tabs = strip?.querySelector<HTMLElement>(".dv-tabs-container");
    const actions = root.current?.closest<HTMLElement>(".dv-right-actions-container");
    if (!strip || !tabs || !actions || typeof ResizeObserver === "undefined") return;

    function update() {
      if (!strip || !tabs || !actions || !root.current) return;
      // jsdom and hidden groups report 0; keep the full row there.
      if (strip.clientWidth === 0) return;
      setNarrow((wasNarrow) => {
        if (!wasNarrow) fullWidth.current = root.current?.offsetWidth ?? fullWidth.current;
        // Other strip actions (the panel move menu) keep their width either way.
        const otherActions = actions.offsetWidth - (root.current?.offsetWidth ?? 0);
        return strip.clientWidth < tabs.scrollWidth + otherActions + fullWidth.current;
      });
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [root]);

  return narrow;
}

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
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrowTabStrip(rootRef);

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

  const maximizeButton = onToggleMaximize ? (
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
  ) : null;

  // Too narrow for the tabs and every icon: fold all but maximize into "⋯" so
  // the tabs themselves stay visible instead of spilling into dockview's
  // overflow dropdown.
  if (narrow) {
    return (
      <div ref={rootRef} className="flex shrink-0 items-center gap-0.5">
        <PrReviewToolbarMenu
          items={[
            { label: "Zoom in (Ctrl++)", onSelect: onZoomIn, disabled: !canZoomIn, keepOpen: true },
            { label: "Zoom out (Ctrl+-)", onSelect: onZoomOut, disabled: !canZoomOut, keepOpen: true },
            { label: `Reset zoom (${Math.round(zoom * 100)}%)`, onSelect: onResetZoom, keepOpen: true },
            ...(selectedPr ? [{ label: "Email a link", onSelect: emailLink }] : []),
            ...(selectedPr && onOpenLinkedWorkItems
              ? [{ label: "Preview linked work items (T)", onSelect: onOpenLinkedWorkItems }]
              : []),
          ]}
        />
        {maximizeButton}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex shrink-0 items-center gap-0.5">
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
          onClick={emailLink}
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
      {maximizeButton}
    </div>
  );
}
