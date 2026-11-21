import type { DockviewApi } from "dockview-react";
import type { DockablePanelSpec } from "./DockableWorkspace";

/**
 * Pins each group's width constraints explicitly, derived from every panel
 * sitting in it.
 *
 * A dockview group with no explicit constraint of its own falls back to
 * whichever panel is *currently active* in it (`DockviewGroupPanel.maximumWidth`
 * / `minimumWidth`). That makes the resize limits of a tabbed group flip as the
 * user switches tabs: Work Items tabs "Result" (no `maxWidth`, `minWidth: 320`)
 * into the same group as "Preview" (`maxWidth` set, `minWidth: 300`), so the
 * pane resizes to different bounds depending on which tab happens to be in
 * front -- the same drag lands somewhere else, which reads as the width
 * adjustment being unstable.
 *
 * Setting the constraint on the *group* takes priority over that per-panel
 * fallback, so a group's bounds stay put regardless of the active tab. A group
 * is bounded by the widest floor its panels need (so no panel is squeezed below
 * its own minimum) and, for the ceiling, only limited when every panel in it
 * agrees to a maximum -- one unbounded panel leaves the group unbounded.
 *
 * Call this only where group membership actually changes (initial build,
 * layout restore, and the move menu). It must NOT be wired to
 * `onDidLayoutChange`: `setConstraints` makes dockview fire a layout change of
 * its own, which comes straight back here and spins forever.
 */
export function applyGroupConstraints(api: DockviewApi, specs: DockablePanelSpec[]) {
  const specsById = new Map(specs.map((spec) => [spec.id, spec]));
  const seen = new Set<string>();

  for (const spec of specs) {
    const group = api.getPanel(spec.id)?.api.group;
    if (!group || seen.has(group.id)) continue;
    seen.add(group.id);

    const groupSpecs = group.panels
      .map((panel) => specsById.get(panel.id))
      .filter((entry): entry is DockablePanelSpec => entry !== undefined);
    if (groupSpecs.length === 0) continue;

    const mins = groupSpecs
      .map((entry) => entry.minWidth)
      .filter((value): value is number => value !== undefined);
    // A panel with no `position` is the anchor pane, which is deliberately
    // unbounded above; and an unbounded panel anywhere in the group makes the
    // whole group unbounded.
    const maxes = groupSpecs.map((entry) => (entry.position ? entry.maxWidth : undefined));

    // Both bounds are always passed as explicit numbers. dockview ignores an
    // `undefined` in this payload (it only assigns when the value is a
    // number), so omitting the ceiling would leave the group falling back to
    // the active tab again -- an unbounded group has to be spelled out.
    const minimumWidth = mins.length > 0 ? Math.max(...mins) : 0;
    const maximumWidth = maxes.every((value) => value !== undefined)
      ? Math.min(...(maxes as number[]))
      : Number.MAX_SAFE_INTEGER;

    const heightMins = groupSpecs
      .map((entry) => entry.minHeight)
      .filter((value): value is number => value !== undefined);
    const heightMaxes = groupSpecs.map((entry) => (entry.position ? entry.maxHeight : undefined));
    const minimumHeight = heightMins.length > 0 ? Math.max(...heightMins) : 0;
    const maximumHeight = heightMaxes.every((value) => value !== undefined)
      ? Math.min(...(heightMaxes as number[]))
      : Number.MAX_SAFE_INTEGER;

    group.api.setConstraints({ minimumWidth, maximumWidth, minimumHeight, maximumHeight });
  }
}
