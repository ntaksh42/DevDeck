import { useRef, type ReactNode, type RefObject } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { PreviewZoomControls } from "./PreviewZoomControls";
import { ViewOptionsMenu, type ViewOptionsItem } from "./ViewOptionsMenu";

const ICON_BUTTON_CLASS =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export type PreviewToolbarZoom = {
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
};

// The one tab-strip control row every preview shares: [leading] zoom, maximize
// (where the preview can), and the "⋯" View options menu holding everything
// else. `leading` is for direct actions that must stay one click away.
// `children` render next to the menu so a menu item can open a popover that
// anchors under the toolbar; `menuTriggerRef` lets them hand focus back.
export function PreviewToolbar({
  zoom,
  maximize,
  items,
  leading,
  menuTriggerRef,
  children,
}: {
  zoom: PreviewToolbarZoom;
  maximize?: { maximized: boolean; onToggle: () => void; label?: string };
  items: ViewOptionsItem[];
  leading?: ReactNode;
  menuTriggerRef?: RefObject<HTMLButtonElement | null>;
  children?: ReactNode;
}) {
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const maximizeText = maximize?.maximized
    ? "Restore split view"
    : (maximize?.label ?? "Maximize preview");

  return (
    <div className="relative flex shrink-0 items-center gap-0.5">
      {leading}
      <PreviewZoomControls
        canZoomIn={zoom.canZoomIn}
        canZoomOut={zoom.canZoomOut}
        zoom={zoom.zoom}
        onZoomIn={zoom.onZoomIn}
        onZoomOut={zoom.onZoomOut}
        onReset={zoom.onResetZoom}
      />
      {maximize ? (
        <button
          type="button"
          onClick={maximize.onToggle}
          aria-label={maximizeText}
          aria-pressed={maximize.maximized}
          title={`${maximizeText} (\\)`}
          className={ICON_BUTTON_CLASS}
        >
          {maximize.maximized ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      ) : null}
      <ViewOptionsMenu items={items} triggerRef={menuTriggerRef ?? ownTriggerRef} />
      {children}
    </div>
  );
}
