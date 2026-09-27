import { useEffect, useRef, type ReactNode } from "react";
import type { DockviewApi, DockviewGroupPanel } from "dockview-react";

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

  const fold = (group: DockviewGroupPanel) => {
    group.api.setConstraints({ minimumHeight: 0, maximumHeight: COLLAPSED_GROUP_HEIGHT });
    group.api.setSize({ height: COLLAPSED_GROUP_HEIGHT });
  };

  // Moving a collapsed panel (the Move panel menu) re-adds it at full size
  // and resets its group's constraints; fold it again whenever that happens.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !collapsedKey) return;
    const collapsed = collapsedKey.split(",");
    const subscription = api.onDidLayoutChange(() => {
      for (const id of collapsed) {
        const group = api.getPanel(id)?.api.group;
        if (group && group.api.height > COLLAPSED_GROUP_HEIGHT + 1) fold(group);
      }
    });
    return () => subscription.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedKey]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const collapsed = new Set(collapsedKey ? collapsedKey.split(",") : []);
    for (const spec of panels.current) {
      const group = api.getPanel(spec.id)?.api.group;
      if (!group) continue;
      if (collapsed.has(spec.id)) {
        if (!expandedHeights.current.has(spec.id)) expandedHeights.current.set(spec.id, group.api.height);
        fold(group);
      } else if (expandedHeights.current.has(spec.id)) {
        const previous = expandedHeights.current.get(spec.id) ?? 0;
        expandedHeights.current.delete(spec.id);
        reapplyConstraints(api);
        // A height at or below the minimum was not chosen by the user: a
        // layout restored while collapsed only remembers the strip, which
        // dockview clamps up to the minimum before it is recorded. Open to
        // half of the column then, like a fresh split.
        const column = group.element.closest<HTMLElement>(".dv-split-view-container")?.clientHeight ?? 0;
        const height = previous > (spec.minHeight ?? COLLAPSED_GROUP_HEIGHT + 1)
          ? previous
          : Math.max(spec.minHeight ?? 0, Math.round(column / 2)) || (spec.initialHeight ?? 200);
        group.api.setSize({ height });
      }
    }
    // Only the collapsed set drives this; the refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedKey]);
}
