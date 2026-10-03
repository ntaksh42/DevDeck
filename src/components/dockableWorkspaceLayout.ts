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
