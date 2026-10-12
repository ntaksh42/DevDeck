import { AppWindow, ExternalLink } from "lucide-react";
import { PreviewToolbar, type PreviewToolbarZoom } from "@/components/PreviewToolbar";

const ICON_BUTTON_CLASS =
  "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

// Tab-strip controls of the Inbox conversation: the two "open" actions as icon
// buttons ahead of the shared zoom + "⋯" View options group.
export function InboxPreviewToolbar({
  zoom,
  canOpenInApp,
  canOpenInBrowser,
  canCopyLink,
  canAskAgent,
  onOpenInApp,
  onOpenInBrowser,
  onCopyLink,
  onAskAgent,
}: {
  zoom: PreviewToolbarZoom;
  canOpenInApp: boolean;
  canOpenInBrowser: boolean;
  canCopyLink: boolean;
  canAskAgent: boolean;
  onOpenInApp: () => void;
  onOpenInBrowser: () => void;
  onCopyLink: () => void;
  onAskAgent: () => void;
}) {
  return (
    <PreviewToolbar
      zoom={zoom}
      leading={
        <>
          <button
            type="button"
            disabled={!canOpenInApp}
            onClick={onOpenInApp}
            aria-label="Open in DevDeck (Shift+Enter)"
            title="Open in DevDeck (Shift+Enter)"
            className={ICON_BUTTON_CLASS}
          >
            <AppWindow className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!canOpenInBrowser}
            onClick={onOpenInBrowser}
            aria-label="Open in Azure DevOps (O / Ctrl+Enter)"
            title="Open in Azure DevOps (O / Ctrl+Enter)"
            className={ICON_BUTTON_CLASS}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      }
      items={[
        { label: "Copy URL", hint: "C", onSelect: onCopyLink, disabled: !canCopyLink },
        { label: "Ask the agent", hint: "Q", onSelect: onAskAgent, disabled: !canAskAgent },
      ]}
    />
  );
}
