import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Move,
  PanelsTopLeft,
} from "lucide-react";
import {
  DockviewReact,
  DockviewDefaultTab,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanel,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { ResizeHandle } from "@/components/ResizeHandle";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { useIsDarkMode } from "@/lib/useIsDarkMode";

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
   * `initialWidth` directly out of the *referenced* panel's own space (not
   * the row's free space), which can force that panel down to its floor.
   */
  position?: { relativeTo: string; direction: "left" | "right" | "above" | "below" | "within" };
  /** Width in pixels when this panel is first split out. Ignored for `"within"`. */
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

interface PanelContentParams {
  content: ReactNode;
}

function PanelContent(props: IDockviewPanelProps<PanelContentParams>) {
  return (
    <div style={{ display: "grid", height: "100%", minHeight: 0, minWidth: 0, width: "100%" }}>
      {props.params.content}
    </div>
  );
}

const PANEL_COMPONENTS = { content: PanelContent };
const LAYOUT_SCHEMA_SUFFIX = ":schema:v3";

const MOVE_DIRECTIONS: {
  direction: "left" | "right" | "above" | "below" | "within";
  label: string;
  Icon: typeof ArrowLeftToLine;
}[] = [
  { direction: "left", label: "Split left of", Icon: ArrowLeftToLine },
  { direction: "right", label: "Split right of", Icon: ArrowRightToLine },
  { direction: "above", label: "Split above", Icon: ArrowUpToLine },
  { direction: "below", label: "Split below", Icon: ArrowDownToLine },
  { direction: "within", label: "Tab with", Icon: PanelsTopLeft },
];

/**
 * dockview's own drag-and-drop is the only built-in way to move a panel to a
 * new split or tab group, and its keyboard-driven equivalent ("KeyboardDocking")
 * is a dockview-enterprise module we don't have -- so without this menu,
 * repositioning a panel is mouse-only, which fails this app's keyboard-operability
 * requirement outright. Moving is implemented as `removePanel` + `addPanel` at
 * the new position (both public, free-tier APIs); dockview has no public
 * "move an existing panel" call.
 */
function PanelMoveMenu({
  panel,
  containerApi,
  panelsRef,
}: {
  panel: IDockviewPanel;
  containerApi: DockviewApi;
  panelsRef: { current: DockablePanelSpec[] };
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && target !== buttonRef.current) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function moveFocus(delta: number) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    items[(current + delta + items.length) % items.length]?.focus();
  }

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    }
  }

  function move(targetId: string, direction: (typeof MOVE_DIRECTIONS)[number]["direction"]) {
    const spec = panelsRef.current.find((entry) => entry.id === panel.id);
    if (!spec) return;
    containerApi.removePanel(panel);
    containerApi.addPanel<PanelContentParams>({
      id: spec.id,
      component: "content",
      title: spec.title,
      params: { content: spec.content },
      minimumWidth: spec.minWidth,
      maximumWidth: spec.maxWidth,
      position: { referencePanel: targetId, direction },
      initialWidth: spec.initialWidth,
    });
    // Moving a panel changes which panels share a group, so the per-group
    // bounds no longer match the membership they were computed from.
    applyGroupConstraints(containerApi, panelsRef.current);
    setOpen(false);
    buttonRef.current?.focus();
  }

  const targets = containerApi.panels.filter((candidate) => candidate.id !== panel.id);
  if (targets.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move ${panel.title ?? panel.id} panel`}
        title="Move panel"
        onClick={() => setOpen((value) => !value)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Move className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Move ${panel.title ?? panel.id}`}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs shadow-lg"
        >
          {targets.map((target) => {
            const title = panelsRef.current.find((entry) => entry.id === target.id)?.title ?? target.id;
            return (
              <div key={target.id} className="mb-1 border-b border-border pb-1 last:mb-0 last:border-0">
                <div className="truncate px-2 py-0.5 font-semibold text-muted-foreground">{title}</div>
                <div className="grid grid-cols-5 gap-0.5 px-1">
                  {MOVE_DIRECTIONS.map(({ direction, label, Icon }) => (
                    <button
                      key={direction}
                      role="menuitem"
                      type="button"
                      aria-label={`${label} ${title}`}
                      title={`${label} ${title}`}
                      onClick={() => move(target.id, direction)}
                      className="flex items-center justify-center rounded p-1 hover:bg-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Combines the keyboard-accessible move menu and resize handle into one
 * `rightHeaderActionsComponent`. The move menu shows for any group's active
 * panel; the resize handle only for panels with size constraints (i.e. every
 * panel but the anchor).
 */
function createHeaderActions(
  resizeSpecs: Map<string, { min: number; max: number; defaultWidth: number; title: string }>,
  panelsRef: { current: DockablePanelSpec[] },
) {
  return function HeaderActions({ api, group, containerApi, activePanel }: IDockviewHeaderActionsProps) {
    const resizablePanel = group.panels.find((panel) => resizeSpecs.has(panel.id));
    const [width, setWidth] = useState(() => api.width);

    useEffect(() => {
      const disposable = api.onDidDimensionsChange((event) => setWidth(event.width));
      return () => disposable.dispose();
    }, [api]);

    const resizeSpec = resizablePanel ? resizeSpecs.get(resizablePanel.id) : undefined;

    return (
      <div className="flex h-full items-center gap-0.5 pr-0.5">
        {activePanel ? (
          <PanelMoveMenu panel={activePanel} containerApi={containerApi} panelsRef={panelsRef} />
        ) : null}
        {resizeSpec ? (
          <ResizeHandle
            ariaLabel={`Resize ${resizeSpec.title}`}
            direction={-1}
            min={resizeSpec.min}
            max={resizeSpec.max}
            value={width}
            // Report back the width dockview actually applied. It clamps a
            // group to what the surrounding layout allows (the sibling grid's
            // own minWidth stops the drag well before this panel's `max`), and
            // `api.width` reflects that synchronously -- unlike the `width`
            // state above, which only catches up a render later via
            // `onDidDimensionsChange`. Handing the handle the real width lets
            // it re-anchor on the limit instead of accumulating a request that
            // runs away past it.
            onChange={(next) => {
              api.setSize({ width: next });
              return api.width;
            }}
            onReset={() => api.setSize({ width: resizeSpec.defaultWidth })}
            className="flex h-5 w-4 shrink-0"
          />
        ) : null}
      </div>
    );
  };
}

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
function applyGroupConstraints(api: DockviewApi, specs: DockablePanelSpec[]) {
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

    group.api.setConstraints({ minimumWidth, maximumWidth });
  }
}

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
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const dockviewElementRef = useRef<HTMLDivElement | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dark = useIsDarkMode();
  const layoutStorageKey = `${storageKey}${LAYOUT_SCHEMA_SUFFIX}`;
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  // Frozen at first render: dockview reads `rightHeaderActionsComponent` only
  // once, at mount, the same as `onReady` below.
  const rightHeaderActionsComponent = useRef(
    createHeaderActions(
      new Map(
        panels
          .filter((panel) => panel.position && panel.minWidth !== undefined && panel.maxWidth !== undefined)
          .map((panel) => [
            panel.id,
            {
              min: panel.minWidth!,
              max: panel.maxWidth!,
              defaultWidth: panel.initialWidth ?? panel.minWidth!,
              title: panel.title,
            },
          ]),
      ),
      panelsRef,
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
      dockviewElementRef.current
        ?.querySelector<HTMLElement>(".dv-dockview")
        ?.style.setProperty("--dv-tabs-and-actions-container-height", "20px");
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
                }
              : {}),
          });
        }
        applyGroupConstraints(api, initialPanels);
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
    <div className="flex min-h-0 min-w-0 flex-1">
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
  );
}
