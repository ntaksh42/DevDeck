import type { DockviewApi } from "dockview-react";
import type { DockablePanelSpec } from "./DockableWorkspace";

/**
 * The narrowest width the default arrangement can lay out in without a pane
 * overflowing the workspace: the sum of each side-by-side group's floor.
 * Panels tabbed into one group (`"within"`) share a group and count once at
 * their widest floor; panels stacked `"above"`/`"below"` share the row's width
 * and add nothing. dockview itself cannot shrink below its panels' minimums, so
 * it overflows (and gets clipped) when the container is narrower than this.
 */
export function minRowWidth(panels: DockablePanelSpec[]): number {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const groupFloors = new Map<string, number>();

  for (const panel of panels) {
    let root = panel;
    while (root.position?.direction === "within") {
      const parent = byId.get(root.position.relativeTo);
      if (!parent) break;
      root = parent;
    }
    if (root.position?.direction === "above" || root.position?.direction === "below") continue;
    groupFloors.set(root.id, Math.max(groupFloors.get(root.id) ?? 0, panel.minWidth ?? 0));
  }

  let total = 0;
  for (const floor of groupFloors.values()) total += floor;
  return total;
}

/** Share of the list + preview row a default arrangement gives the list, so its Title column has room. */
export const DEFAULT_LIST_SHARE = 0.55;

/**
 * Splits the anchor panel (the view's list) and the panel opened to its right
 * (the preview) `DEFAULT_LIST_SHARE` : rest. Used after the Agent column is
 * first docked into a freshly built layout, since that column is carved out of
 * the list; a restored layout keeps the user's sizes.
 */
export function balanceListAndPreview(api: DockviewApi, panels: DockablePanelSpec[]): void {
  const anchor = panels.find((panel) => !panel.position);
  const neighbour = panels.find(
    (panel) => panel.position?.relativeTo === anchor?.id && panel.position?.direction === "right",
  );
  const list = anchor && api.getPanel(anchor.id);
  const preview = neighbour && api.getPanel(neighbour.id);
  if (!list || !preview || list.group === preview.group) return;
  const total = list.group.api.width + preview.group.api.width;
  if (total <= 0) return;
  // Shrinking the preview first hands its space to the list, its neighbour;
  // growing the list directly would take it from the far (Agent) column.
  preview.group.api.setSize({ width: total - Math.round(total * DEFAULT_LIST_SHARE) });
  list.group.api.setSize({ width: Math.round(total * DEFAULT_LIST_SHARE) });
}
