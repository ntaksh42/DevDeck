import { useEffect, useRef, type ReactNode } from "react";
import type { DockviewApi } from "dockview-react";

/** Height of a collapsed group: just its tab strip (`--dv-tabs-and-actions-container-height`). */
export const COLLAPSED_GROUP_HEIGHT = 20;

/**
 * Per-panel header content, read by the (frozen-at-mount) header actions
 * component through `useSyncExternalStore`, so a panel's header can change on
 * every render the same way its `content` does.
 */
export function createHeaderSlotStore() {
  let slots = new Map<string, ReactNode>();
  const listeners = new Set<() => void>();
  return {
    get: (id: string | undefined): ReactNode => (id ? slots.get(id) : undefined),
    set(next: Map<string, ReactNode>) {
      slots = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type HeaderSlotStore = ReturnType<typeof createHeaderSlotStore>;

/**
 * Shrinks the group of each panel in `collapsedIds` down to its tab strip, and
 * restores it (to the height it had before collapsing) when it leaves the list.
 * `reapplyConstraints` puts back the group's normal min/max height.
 */
export function useCollapsedGroups(
  apiRef: { current: DockviewApi | null },
  panels: { current: { id: string; initialHeight?: number; minHeight?: number }[] },
  collapsedIds: string[] | undefined,
  reapplyConstraints: (api: DockviewApi) => void,
) {
  const expandedHeights = useRef(new Map<string, number>());
  const collapsedKey = (collapsedIds ?? []).join(",");

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const collapsed = new Set(collapsedKey ? collapsedKey.split(",") : []);
    for (const spec of panels.current) {
      const group = api.getPanel(spec.id)?.api.group;
      if (!group) continue;
      if (collapsed.has(spec.id)) {
        if (!expandedHeights.current.has(spec.id)) expandedHeights.current.set(spec.id, group.api.height);
        group.api.setConstraints({ minimumHeight: 0, maximumHeight: COLLAPSED_GROUP_HEIGHT });
        group.api.setSize({ height: COLLAPSED_GROUP_HEIGHT });
      } else if (expandedHeights.current.has(spec.id)) {
        const previous = expandedHeights.current.get(spec.id) ?? 0;
        expandedHeights.current.delete(spec.id);
        reapplyConstraints(api);
        // A layout restored while collapsed only remembers the strip height.
        const height = previous > COLLAPSED_GROUP_HEIGHT + 1
          ? previous
          : (spec.initialHeight ?? spec.minHeight ?? 200);
        group.api.setSize({ height });
      }
    }
    // Only the collapsed set drives this; the refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedKey]);
}
