import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAgentDock } from "@/components/agent/useAgentDock";
import {
  DockviewReact,
  DockviewDefaultTab,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type SerializedDockview,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { useIsDarkMode } from "@/lib/useIsDarkMode";
import { COLLAPSED_GROUP_HEIGHT, createHeaderSlotStore, useCollapsedGroups } from "./dockableWorkspaceSlots";
import { balanceListAndPreview, minRowWidth } from "./dockableWorkspaceLayout";
import { PanelContent, type PanelContentParams } from "./DockablePanelContent";
import { createHeaderActions } from "./DockableHeaderActions";
import { applyGroupConstraints } from "./dockableGroupConstraints";

export interface DockablePanelSpec {
  id: string;
  title: string;
  content: ReactNode;
  /**
   * Where to place this panel when the layout is first built (ignored once a
   * layout has been persisted and is restored instead). Omit for the anchor
   * panel -- the first panel with no `position` becomes the root everything
   * else is placed relative to. `"within"` adds this panel as a tab in the
   * reference panel's own group rather than splitting off new space -- the
   * right default for something the user can drag into its own pane later,
   * since a `"left"`/`"right"`/`"above"`/`"below"` split carves its
   * `initialWidth`/`initialHeight` directly out of the *referenced* panel's own space (not
   * the row's free space), which can force that panel down to its floor.
   */
  position?: { relativeTo: string; direction: "left" | "right" | "above" | "below" | "within" };
  /** Dimensions in pixels when this panel is first split out. Ignored for `"within"`. */
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Rendered in the group's tab strip (left of the move menu) while this panel is active. */
  headerActions?: ReactNode;
}

const PANEL_COMPONENTS = { content: PanelContent };
const LAYOUT_SCHEMA_SUFFIX = ":schema:v3";


/**
 * A dockable workspace of named panels built on dockview: panels can be
 * dragged into tab groups together, split side by side, floated, or
 * maximized like Visual Studio tool windows. The resulting arrangement
 * persists per `storageKey`.
 *
 * `panels` is re-synced into the already-created dockview panels on every
 * render (dockview only calls `onReady` once, at mount), so callers can pass
 * fresh JSX for each panel's `content` the same way they would to a plain
 * component. Adding or removing an entry from `panels` across renders is not
 * supported -- the panel set is fixed at mount (from the first render's
 * value); only each panel's own `content` is expected to change over time.
 */
export function DockableWorkspace({
  storageKey,
  panels,
  maximizedId,
  activatePanel,
  collapsedIds,
}: {
  storageKey: string;
  panels: DockablePanelSpec[];
  /** Id of the panel to show maximized, or undefined to show the normal layout. */
  maximizedId?: string;
  /**
   * Imperatively bring a panel's tab to the front -- e.g. after an action
   * that should jump the user to a specific pane even if they had manually
   * switched to a different tab in the same group. Bump `key` to re-trigger
   * activating the same `id` again (a plain `id` string wouldn't re-run the
   * effect on a second identical activation).
   */
  activatePanel?: { id: string; key: number };
  /** Panels whose group is shrunk to just its tab strip. */
  collapsedIds?: string[];
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const dockviewElementRef = useRef<HTMLDivElement | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dark = useIsDarkMode();
  const layoutStorageKey = `${storageKey}${LAYOUT_SCHEMA_SUFFIX}`;
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const headerSlots = useRef(createHeaderSlotStore()).current;
  // Set once dockview has built or restored the layout, so effects that need
  // the api (collapsing a group) re-run then instead of missing it at mount.
  const [dockReady, setDockReady] = useState(false);
  // True when this mount built the default arrangement rather than restoring one.
  const freshLayoutRef = useRef(false);

  // Frozen at first render: dockview reads `rightHeaderActionsComponent` only
  // once, at mount, the same as `onReady` below.
  const rightHeaderActionsComponent = useRef(
    createHeaderActions(
      new Map(
        panels
          .filter(
            (panel) =>
              panel.position &&
              panel.minWidth !== undefined ||
              panel.maxWidth !== undefined ||
              panel.minHeight !== undefined ||
              panel.maxHeight !== undefined,
          )
          .map((panel) => [
            panel.id,
            {
              minWidth: panel.minWidth,
              maxWidth: panel.maxWidth,
              defaultWidth: panel.initialWidth ?? panel.minWidth!,
              minHeight: panel.minHeight,
              maxHeight: panel.maxHeight,
              defaultHeight: panel.initialHeight ?? panel.minHeight!,
              splitsWithList:
                panel.position?.direction === "right" &&
                panel.position.relativeTo === panels.find((candidate) => !candidate.position)?.id,
              title: panel.title,
            },
          ]),
      ),
      panelsRef,
      headerSlots,
    ),
  ).current;

  function syncPanelContent() {
    const api = apiRef.current;
    if (!api) return;
    for (const spec of panelsRef.current) {
      api.getPanel(spec.id)?.api.updateParameters({ content: spec.content });
    }
  }

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;
      setDockReady(true);
      dockviewElementRef.current
        ?.querySelector<HTMLElement>(".dv-dockview")
        ?.style.setProperty("--dv-tabs-and-actions-container-height", `${COLLAPSED_GROUP_HEIGHT}px`);
      const initialPanels = panelsRef.current;

      const saved = readStoredJson<SerializedDockview | undefined>(
        layoutStorageKey,
        (raw) => raw as SerializedDockview,
        undefined,
      );

      let restored = false;
      if (saved) {
        try {
          api.fromJSON(saved);
          restored = initialPanels.every((spec) => api.getPanel(spec.id) !== undefined);
        } catch {
          restored = false;
        }
        // A saved layout from before a panel was added/removed (e.g. an
        // older build's 2-panel layout once a 3rd panel like "result" was
        // introduced) restores the panels it does know about, so `restored`
        // above comes back false -- but they're still sitting in `api` and
        // would collide with the fresh `addPanel` calls below ("panel with
        // id ... already exists"). Tear down whatever fromJSON left behind
        // before rebuilding from scratch.
        if (!restored) {
          for (const panel of [...api.panels]) api.removePanel(panel);
        } else {
          // A saved layout from before a panel was removed (e.g. the PR
          // review's Commits / Files changed tabs) would otherwise keep that
          // panel as an empty tab.
          const knownIds = new Set(initialPanels.map((spec) => spec.id));
          for (const panel of [...api.panels]) {
            if (!knownIds.has(panel.id)) api.removePanel(panel);
          }
        }
      }

      if (restored) {
        // `fromJSON` restores each panel's *size* but not the min/max
        // constraints passed to the original `addPanel` call -- left
        // unset, a restored panel can be dragged past its configured
        // bounds, and since dockview then has to shrink some *other*
        // panel to compensate, the drag can visibly bounce/snap as the
        // constraint on that other panel kicks in first. Re-apply them
        // here so a restored layout enforces the same bounds as a fresh
        // one; the saved *size* itself is left alone.
        applyGroupConstraints(api, initialPanels);
        syncPanelContent();
      } else {
        for (const spec of initialPanels) {
          api.addPanel<PanelContentParams>({
            id: spec.id,
            component: "content",
            title: spec.title,
            params: { content: spec.content },
            minimumWidth: spec.minWidth,
            maximumWidth: spec.position ? spec.maxWidth : undefined,
            minimumHeight: spec.minHeight,
            maximumHeight: spec.position ? spec.maxHeight : undefined,
            // Adding a panel activates it by default, which would steal
            // focus from whatever tab the user (or the caller's default
            // arrangement) already had showing in that group -- only a
            // freshly split-off panel (its own new group) should become
            // active; one joining an existing group as a tab should not.
            inactive: spec.position?.direction === "within",
            ...(spec.position
              ? {
                  position: { referencePanel: spec.position.relativeTo, direction: spec.position.direction },
                  initialWidth: spec.initialWidth,
                  initialHeight: spec.initialHeight,
                }
              : {}),
          });
        }
        applyGroupConstraints(api, initialPanels);
        freshLayoutRef.current = true;
        balanceListAndPreview(api, initialPanels);
      }

      // `onDidLayoutChange` covers structural changes (panels added/removed/
      // moved) but not a pure size change from the keyboard-resize action
      // above, so persist on each group's dimension changes too (the group
      // API reflects dockview's own layout-engine bookkeeping directly; the
      // panel-level equivalent depends on a ResizeObserver on its content
      // element, which won't fire in a test environment without real DOM
      // measurement).
      //
      // `toJSON()` embeds each panel's `params`, which is the React element
      // passed as `content` -- that survives one JSON round-trip as a plain
      // object (not a real element), so restoring it later would crash
      // React. Strip params before persisting; content is always re-supplied
      // via `updateParameters` on restore anyway.
      //
      // A drag-and-drop move can leave dockview's internal grid mid-restructure
      // for one of these events; serializing at that exact moment has been
      // observed to throw ("Index out of bounds" inside dockview's own
      // gridview code) even though the drag itself completes fine. A failed
      // persist is not worth crashing the whole app over -- log and skip
      // that snapshot; the next layout/dimension event (once things settle)
      // persists normally.
      const persist = () => {
        try {
          const layout = api.toJSON();
          for (const panel of Object.values(layout.panels)) {
            panel.params = undefined;
          }
          writeStoredJson(layoutStorageKey, layout);
        } catch (error) {
          console.error(`DockableWorkspace(${storageKey}): failed to persist layout`, error);
        }
      };
      const schedulePersist = () => {
        if (persistTimeoutRef.current !== null) clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = setTimeout(() => {
          persistTimeoutRef.current = null;
          persist();
        }, 100);
      };
      api.onDidLayoutChange(schedulePersist);
      for (const spec of initialPanels) {
        api.getPanel(spec.id)?.api.group.api.onDidDimensionsChange(schedulePersist);
      }
    },
    // Mount-only: dockview calls onReady exactly once when the instance is
    // created. Later `panels` changes are pushed via the effect below instead
    // of re-running this setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutStorageKey, storageKey],
  );

  useEffect(() => {
    syncPanelContent();
  });

  // Layout effect so header content (e.g. a filter that opened on Ctrl+F) is
  // in the DOM -- and can take focus -- before the next keystroke is handled.
  useLayoutEffect(() => {
    headerSlots.set(new Map(panels.map((panel) => [panel.id, panel.headerActions])));
  });

  // The app-wide Agent panel joins this workspace while it is open (Ctrl+J).
  // Docking the Agent carves its column out of the list, so re-split a fresh layout afterwards.
  const agentWidth = useAgentDock(apiRef, dockReady, layoutStorageKey, (api) => {
    if (freshLayoutRef.current) balanceListAndPreview(api, panelsRef.current);
  });

  useCollapsedGroups(apiRef, panelsRef, dockReady ? collapsedIds : undefined, (api) =>
    applyGroupConstraints(api, panelsRef.current),
  );

  useEffect(() => () => {
    if (persistTimeoutRef.current !== null) clearTimeout(persistTimeoutRef.current);
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const panel = maximizedId ? api.getPanel(maximizedId) : undefined;
    if (panel) {
      api.maximizeGroup(panel);
    } else if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup();
    }
  }, [maximizedId]);

  useEffect(() => {
    if (!activatePanel) return;
    apiRef.current?.getPanel(activatePanel.id)?.api.setActive();
    // `key` (not just `id`) is the trigger: activating the same id again
    // needs a bumped key to re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activatePanel?.id, activatePanel?.key]);

  return (
    // Below the panels' combined floor dockview overflows its container and the
    // right pane is clipped with no way to reach it; scroll instead.
    <div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex min-w-0 flex-1" style={{ minWidth: minRowWidth(panels) + agentWidth }}>
      <DockviewReact
        key={layoutStorageKey}
        ref={dockviewElementRef}
        className={dark ? "dockview-theme-dark" : "dockview-theme-light"}
        components={PANEL_COMPONENTS}
        defaultTabComponent={(props) => <DockviewDefaultTab {...props} hideClose />}
        // A background tab (stacked behind the active one in the same group)
        // unmounts, so a panel's own queries/effects only run while it's
        // actually visible -- important once panels tab together instead of
        // each always being its own separate, always-visible split. Panels
        // genuinely visible side by side in different groups stay mounted.
        defaultRenderer="onlyWhenVisible"
        // The default "auto" strategy drags tabs via native HTML5
        // drag-and-drop for a mouse pointer, which is unreliable inside the
        // desktop app's WebView2 host (drags don't register a drop). Force
        // dockview's own pointer-based DnD everywhere so dragging a tab into
        // a new split/tab group works the same in the browser and desktop.
        dndStrategy="pointer"
        rightHeaderActionsComponent={rightHeaderActionsComponent}
        onReady={onReady}
        theme={dark ? themeDark : themeLight}
      />
      </div>
    </div>
  );
}
