import type { DockviewApi, IDockviewHeaderActionsProps } from "dockview-react";

export function resizeAdjacentBoundary(
  group: IDockviewHeaderActionsProps["group"],
  previousView: Element,
  containerApi: DockviewApi,
  vertical: boolean,
  next: number,
) {
  const previous = containerApi.groups.find((candidate) => previousView.contains(candidate.element));
  if (!previous) return vertical ? group.api.height : group.api.width;
  const currentSize = vertical ? group.api.height : group.api.width;
  const previousSize = vertical ? previous.api.height : previous.api.width;
  const previousMin = vertical ? previous.minimumHeight : previous.minimumWidth;
  const previousMax = vertical ? previous.maximumHeight : previous.maximumWidth;
  const bounded = Math.max(currentSize + previousSize - previousMax,
    Math.min(next, currentSize + previousSize - previousMin));
  group.api.setSize(vertical ? { height: bounded } : { width: bounded });
  // setSize redistributes space across the split. Restore the adjacent pair's
  // total so the far side of this panel (and Agent beyond it) stays put.
  previous.api.setSize(vertical
    ? { height: previousSize + currentSize - bounded }
    : { width: previousSize + currentSize - bounded });
  return vertical ? group.api.height : group.api.width;
}
