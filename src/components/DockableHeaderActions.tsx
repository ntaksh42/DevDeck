// Dock header actions (move menu + group resize overlay), split from
// DockableWorkspace.tsx to keep files under 500 lines.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Move,
  PanelsTopLeft,
} from "lucide-react";
import type { DockviewApi, IDockviewHeaderActionsProps, IDockviewPanel } from "dockview-react";
import { ResizeHandle } from "@/components/ResizeHandle";
import type { HeaderSlotStore } from "./dockableWorkspaceSlots";
import { resizeAdjacentBoundary } from "./dockableWorkspaceResize";
import { applyGroupConstraints } from "./dockableGroupConstraints";
import type { DockablePanelSpec } from "./DockableWorkspace";
import type { PanelContentParams } from "./DockablePanelContent";
import { DEFAULT_LIST_SHARE } from "./dockableWorkspaceLayout";

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
    // A panel added from outside the view (the app-wide Agent panel) keeps
    // the content it was added with.
    const spec =
      panelsRef.current.find((entry) => entry.id === panel.id) ??
      ({ id: panel.id, title: panel.title ?? panel.id, content: (panel.params as PanelContentParams | undefined)?.content } as DockablePanelSpec);
    if (!spec.content) return;
    containerApi.removePanel(panel);
    containerApi.addPanel<PanelContentParams>({
      id: spec.id,
      component: "content",
      title: spec.title,
      params: { content: spec.content },
      minimumWidth: spec.minWidth,
      maximumWidth: spec.maxWidth,
      minimumHeight: spec.minHeight,
      maximumHeight: spec.maxHeight,
      position: { referencePanel: targetId, direction },
      initialWidth: spec.initialWidth,
      initialHeight: spec.initialHeight,
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
        // Only while the pointer is over the panel, it has focus, or its menu is open.
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground focus:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-expanded:opacity-100 [.dv-groupview:hover_&]:opacity-100"
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

// A panel without height constraints still needs sensible bounds after it is
// moved above or below another panel from the dock menu.
const VERTICAL_SPLIT_MIN_HEIGHT = 120;
const VERTICAL_SPLIT_MAX_HEIGHT = Number.MAX_SAFE_INTEGER;
const FALLBACK_SPLIT_MIN_WIDTH = 120;
const FALLBACK_SPLIT_MAX_WIDTH = Number.MAX_SAFE_INTEGER;

export interface ResizeSpec {
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  defaultHeight?: number;
  /** The preview right of the view's list: its default width is the list's share split (`DEFAULT_LIST_SHARE`), not a fixed size. */
  splitsWithList?: boolean;
  title: string;
}

type ResizePlacement = { axis: "x" | "y"; direction: -1; edge: "leading"; previousView: Element };

/**
 * The shared boundaries this group should carry a resize handle for: the
 * leading (left/top) edge of the nearest split on each axis where the group --
 * or the branch it sits in -- is not the first view. dockview marks each split
 * `dv-horizontal` or `dv-vertical`.
 *
 * Walking up past the group's own split matters for nested layouts: a group
 * stacked in a column (e.g. Conversation above Work Items) is the first view
 * of that vertical split, but its column is the second view of the outer
 * horizontal split, and that column boundary is the only place the preview
 * width can be dragged. Resizing the group's width through `setSize` resizes
 * that enclosing column.
 *
 * One handle per boundary: the later (right/bottom) side owns it, so adjacent
 * overlays never compete for a drag. Re-docking rebuilds the group, so this is
 * stable for an overlay's lifetime.
 */
function groupResizePlacements(group: IDockviewHeaderActionsProps["group"]): ResizePlacement[] {
  const placements: ResizePlacement[] = [];
  const seen = new Set<"x" | "y">();
  let view = group.element.closest<HTMLElement>(".dv-view");
  while (view && seen.size < 2) {
    const viewContainer = view.parentElement;
    const split = viewContainer?.parentElement;
    if (!viewContainer?.classList.contains("dv-view-container") || !split) break;
    const axis = split.classList.contains("dv-vertical") ? "y" : "x";
    if (!seen.has(axis)) {
      seen.add(axis);
      const views = Array.from(viewContainer.children).filter((child) => child.classList.contains("dv-view"));
      const index = views.indexOf(view);
      if (index > 0) placements.push({ axis, direction: -1, edge: "leading", previousView: views[index - 1] });
    }
    view = split.parentElement?.closest<HTMLElement>(".dv-view") ?? null;
  }
  return placements;
}

/**
 * Renders `ResizeHandle` full-height (or full-width, for a `"column"` split)
 * over the group's shared edge, via a portal into `group.element` rather than
 * inline in the header row.
 *
 * dockview draws its own group-boundary drag handle (`.dv-sash`) the full
 * length of the boundary, next to it -- CSS in index.css turns off pointer
 * events on the horizontal-split one so it can't intercept a drag, but that
 * leaves nothing to grab there unless something else covers the same length.
 * A header-row-only `ResizeHandle` used to leave the rest of the boundary
 * dead. Sizing this to the group's own cross-length keeps the whole boundary
 * draggable through the one handle that carries the clamp/re-anchor logic.
 *
 * A later group uses its leading edge, while the first group uses its trailing
 * edge. That keeps the handle on the actual shared boundary for every move-menu
 * direction: left/right as well as above/below. Dragging the shared boundary
 * outward grows its adjacent panel in every direction.
 */
function GroupResizeOverlay({
  group,
  placement,
  labelSuffix,
  resizeSpec,
  dimensions,
  containerApi,
}: {
  group: IDockviewHeaderActionsProps["group"];
  placement: ResizePlacement;
  /** Tells a group's second (outer-split) handle apart from its first. */
  labelSuffix: string;
  resizeSpec: ResizeSpec;
  dimensions: { width: number; height: number };
  containerApi: DockviewApi;
}) {
  const vertical = placement.axis === "y";
  const [initialSize] = useState(() => (vertical ? group.api.height : group.api.width));
  const [crossLength, setCrossLength] = useState(() =>
    vertical ? group.element.clientWidth : group.element.clientHeight,
  );

  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setCrossLength(vertical ? group.element.clientWidth : group.element.clientHeight),
    );
    observer.observe(group.element);
    return () => observer.disconnect();
  }, [group, vertical]);

  const min = vertical
    ? resizeSpec.minHeight ?? VERTICAL_SPLIT_MIN_HEIGHT
    : resizeSpec.minWidth ?? FALLBACK_SPLIT_MIN_WIDTH;
  const max = vertical
    ? resizeSpec.maxHeight ?? VERTICAL_SPLIT_MAX_HEIGHT
    : resizeSpec.maxWidth ?? FALLBACK_SPLIT_MAX_WIDTH;
  const defaultSize = vertical
    ? resizeSpec.defaultHeight ?? initialSize
    : resizeSpec.defaultWidth ?? initialSize;

  const resizeBoundary = (next: number) =>
    resizeAdjacentBoundary(group, placement.previousView, containerApi, vertical, next);

  return createPortal(
    <ResizeHandle
      ariaLabel={`Resize ${resizeSpec.title}${labelSuffix}`}
      axis={vertical ? "y" : "x"}
      direction={placement.direction}
      min={min}
      max={max}
      value={vertical ? dimensions.height : dimensions.width}
      // Report back the size dockview actually applied. It clamps a group to
      // what the surrounding layout allows (a sibling panel's own minWidth/
      // minHeight stops the drag well before this handle's `max`), and
      // `group.api.width`/`.height` reflect that synchronously -- unlike the
      // `size` prop above, which only catches up a render later via
      // `onDidDimensionsChange`. Handing the handle the real size lets it
      // re-anchor on the limit instead of accumulating a request that runs
      // away past it.
      onChange={resizeBoundary}
      onReset={() => {
        const list = resizeSpec.splitsWithList && !vertical
          ? containerApi.groups.find((candidate) => placement.previousView.contains(candidate.element))
          : undefined;
        resizeBoundary(
          list ? Math.round((list.api.width + group.api.width) * (1 - DEFAULT_LIST_SHARE)) : defaultSize,
        );
      }}
      className="absolute left-0 top-0 z-20"
      style={vertical ? { width: crossLength } : { height: crossLength }}
    />,
    group.element,
  );
}

/**
 * The keyboard-accessible move menu, shown in every group's header for its
 * active panel. The resize handle itself now renders full-length via
 * `GroupResizeOverlay` (a portal into the group element) rather than inline
 * here, so it can cover the whole boundary instead of just the header row.
 */
export function createHeaderActions(
  resizeSpecs: Map<string, ResizeSpec>,
  panelsRef: { current: DockablePanelSpec[] },
  headerSlots: HeaderSlotStore,
) {
  return function HeaderActions({ api, group, containerApi, activePanel }: IDockviewHeaderActionsProps) {
    const slot = useSyncExternalStore(headerSlots.subscribe, () => headerSlots.get(activePanel?.id));
    const resizablePanel = group.panels.find((panel) => resizeSpecs.has(panel.id));
    const [placements, setPlacements] = useState(() => groupResizePlacements(group));
    const [dimensions, setDimensions] = useState(() => ({ width: api.width, height: api.height }));

    // A group keeps its HeaderActions while the layout around it changes (a
    // sibling moved next to it, a restore, the Agent docking), so the boundary
    // it owns has to be re-derived; a stale list leaves a boundary with no
    // handle on either side, and the native sash is pointer-events: none.
    useEffect(() => {
      const refresh = () =>
        setPlacements((current) => {
          const next = groupResizePlacements(group);
          const same =
            next.length === current.length &&
            next.every(
              (placement, index) =>
                placement.axis === current[index].axis &&
                placement.previousView === current[index].previousView,
            );
          return same ? current : next;
        });
      let frame = 0;
      // Layout events can fire before dockview has put the views in their new
      // split, so read the DOM once it has settled.
      const refreshSoon = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(refresh);
      };
      refresh();
      const disposable = containerApi.onDidLayoutChange(refreshSoon);
      return () => {
        cancelAnimationFrame(frame);
        disposable.dispose();
      };
    }, [containerApi, group]);

    useEffect(() => {
      const disposable = api.onDidDimensionsChange((event) =>
        setDimensions({ width: event.width, height: event.height }),
      );
      return () => disposable.dispose();
    }, [api]);

    const resizeSpec = resizeSpecs.get(resizablePanel?.id ?? "") ?? {
      title: activePanel?.title ?? group.id,
    };

    return (
      // Above the group's top-edge resize overlay (z-20), which spans the tab
      // strip: the strip's own buttons stay clickable, the rest stays draggable.
      <div className="relative z-30 flex h-full items-center gap-0.5 pr-0.5">
        {slot}
        {activePanel ? (
          <PanelMoveMenu
            panel={activePanel}
            containerApi={containerApi}
            panelsRef={panelsRef}
          />
        ) : null}
        {placements.map((placement, index) => (
          <GroupResizeOverlay
            key={placement.axis}
            group={group}
            placement={placement}
            labelSuffix={index === 0 ? "" : placement.axis === "x" ? " width" : " height"}
            resizeSpec={resizeSpec}
            dimensions={dimensions}
            containerApi={containerApi}
          />
        ))}
      </div>
    );
  };
}
