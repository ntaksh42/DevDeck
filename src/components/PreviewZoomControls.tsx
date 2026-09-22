import { ZoomIn, ZoomOut } from "lucide-react";

const BUTTON_CLASS =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

// Zoom controls shared by every preview panel (work items, PRs, commits).
// Clicking the percentage resets to 100% instead of opening a menu, matching
// the lightweight feel of the neighboring maximize/minimize toggle.
export function PreviewZoomControls({
  canZoomIn,
  canZoomOut,
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onZoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out preview"
        title="Zoom out (Ctrl+-)"
        className={BUTTON_CLASS}
      >
        <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label="Reset preview zoom"
        title="Reset zoom (Ctrl+0)"
        className="w-9 shrink-0 rounded px-0.5 py-0.5 text-center text-[11px] text-muted-foreground tabular-nums hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in preview"
        title="Zoom in (Ctrl++)"
        className={BUTTON_CLASS}
      >
        <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
