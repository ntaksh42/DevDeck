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
      className="outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
      style={{ display: "grid", height: "100%", minHeight: 0, minWidth: 0, width: "100%" }}
    >
      {props.params.content}
    </div>
  );
}
