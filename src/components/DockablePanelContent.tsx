import type { ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { handlePaneFocusKey } from "@/lib/paneFocus";

export interface PanelContentParams {
  content: ReactNode;
}

export function PanelContent(props: IDockviewPanelProps<PanelContentParams>) {
  return (
    <div
      data-focus-pane={props.api.id}
      tabIndex={-1}
      onKeyDownCapture={handlePaneFocusKey}
      className="outline-none focus:ring-2 focus:ring-inset focus:ring-ring has-[[data-primary-grid]]:focus:ring-0"
      // One column no wider than the pane: an auto column would grow to the content's min width (code, tables) and clip it.
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", height: "100%", minHeight: 0, minWidth: 0, width: "100%" }}
    >
      {props.params.content}
    </div>
  );
}
