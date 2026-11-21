import { useEffect, useId, useRef, type RefObject } from "react";
import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { AgentPanelContent } from "./AgentPanelHost";
import { isAgentPanelShown, registerDockHost, useAgentPanelState } from "./agentPanelStore";

export const AGENT_DOCK_PANEL_ID = "agent";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 240;

type Direction = "within" | "left" | "right" | "above" | "below";
/** Without `referencePanel`, a full-length column / row at that edge of the workspace. */
type DockPosition = { referencePanel?: string; direction: Direction; width?: number; height?: number };
const EDGE = 4;

const positionKey = (storageKey: string) => `${storageKey}:agent-dock`;

function rectOf(panel: IDockviewPanel): DOMRect {
  return panel.group.element.getBoundingClientRect();
}

/** Where the panel sits relative to its nearest neighbour, to put it back there next time. */
function positionOf(api: DockviewApi, agent: IDockviewPanel): DockPosition | null {
  const tabMate = agent.group.panels.find((panel) => panel.id !== agent.id);
  if (tabMate) return { referencePanel: tabMate.id, direction: "within" };
  const a = rectOf(agent);
  const root = agent.group.element.closest(".dockview-theme-light, .dockview-theme-dark")?.getBoundingClientRect();
  if (root) {
    const fullHeight = a.top - root.top < EDGE && root.bottom - a.bottom < EDGE;
    const fullWidth = a.left - root.left < EDGE && root.right - a.right < EDGE;
    const size = { width: a.width, height: a.height };
    if (fullHeight && root.right - a.right < EDGE) return { direction: "right", ...size };
    if (fullHeight && a.left - root.left < EDGE) return { direction: "left", ...size };
    if (fullWidth && root.bottom - a.bottom < EDGE) return { direction: "below", ...size };
    if (fullWidth && a.top - root.top < EDGE) return { direction: "above", ...size };
  }
  let best: { gap: number; position: DockPosition } | null = null;
  for (const panel of api.panels) {
    if (panel.id === agent.id) continue;
    const r = rectOf(panel);
    const overlapV = a.top < r.bottom && r.top < a.bottom;
    const overlapH = a.left < r.right && r.left < a.right;
    const candidates: [boolean, number, Direction][] = [
      [overlapV, Math.abs(a.left - r.right), "right"],
      [overlapV, Math.abs(r.left - a.right), "left"],
      [overlapH, Math.abs(a.top - r.bottom), "below"],
      [overlapH, Math.abs(r.top - a.bottom), "above"],
    ];
    for (const [overlaps, gap, direction] of candidates) {
      if (overlaps && (!best || gap < best.gap)) {
        best = { gap, position: { referencePanel: panel.id, direction, width: a.width, height: a.height } };
      }
    }
  }
  return best?.position ?? null;
}

/** The area the panel will split: its neighbour's group, or the whole workspace at an edge. */
function space(api: DockviewApi, position: DockPosition): DOMRect | undefined {
  const neighbour = position.referencePanel ? api.getPanel(position.referencePanel) : undefined;
  if (neighbour) return rectOf(neighbour);
  return api.panels[0]?.group.element
    .closest(".dockview-theme-light, .dockview-theme-dark")
    ?.getBoundingClientRect();
}

/** The remembered size, but never more than half the space it splits, so the neighbour stays usable. */
function fit(saved: number, min: number, available: number | undefined): number {
  const size = Math.max(saved, min);
  return available ? Math.min(size, Math.max(min, available / 2)) : size;
}

/**
 * Hosts the app-wide Agent panel inside a docked workspace while it is open,
 * so it can be dragged, split and tabbed like the view's own panels. Its last
 * place is remembered per workspace.
 */
/**
 * Returns the width the docked panel needs, so the workspace can grow by it
 * (and scroll) instead of clipping a panel; 0 while it is not docked here.
 */
export function useAgentDock(
  apiRef: RefObject<DockviewApi | null>,
  ready: boolean,
  storageKey: string,
  onDocked?: (api: DockviewApi) => void,
): number {
  const hostId = useId();
  const state = useAgentPanelState();
  const { dockHosts } = state;
  const open = isAgentPanelShown(state);
  const isHost = dockHosts[dockHosts.length - 1] === hostId;

  const onDockedRef = useRef(onDocked);
  onDockedRef.current = onDocked;

  useEffect(() => registerDockHost(hostId), [hostId]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !ready) return;
    const existing = api.getPanel(AGENT_DOCK_PANEL_ID);
    if (open && isHost && !existing) {
      const saved = readStoredJson<DockPosition | null>(positionKey(storageKey), (raw) => raw as DockPosition, null);
      // A neighbour that is no longer in the layout falls back to the default.
      const reference = saved && (!saved.referencePanel || api.getPanel(saved.referencePanel)) ? saved : null;
      api.addPanel({
        id: AGENT_DOCK_PANEL_ID,
        component: "content",
        title: "Agent",
        params: { content: <AgentPanelContent docked /> },
        minimumWidth: MIN_WIDTH,
        ...(reference
          ? {
              position: reference.referencePanel
                ? { referencePanel: reference.referencePanel, direction: reference.direction }
                : { direction: reference.direction as Exclude<Direction, "within"> },
              initialWidth:
                reference.direction === "left" || reference.direction === "right"
                  ? fit(reference.width ?? DEFAULT_WIDTH, MIN_WIDTH, space(api, reference)?.width)
                  : undefined,
              initialHeight:
                reference.direction === "above" || reference.direction === "below"
                  ? fit(reference.height ?? 0, MIN_HEIGHT, space(api, reference)?.height)
                  : undefined,
            }
          : // First time: a full-height column at the workspace's right edge.
            { position: { direction: "right" as const }, initialWidth: DEFAULT_WIDTH }),
      });
      // After dockview has laid the new column out.
      requestAnimationFrame(() => onDockedRef.current?.(api));
    } else if ((!open || !isHost) && existing) {
      const position = positionOf(api, existing);
      if (position) writeStoredJson(positionKey(storageKey), position);
      api.removePanel(existing);
    }
  }, [apiRef, ready, open, isHost, storageKey]);
  return open && isHost ? MIN_WIDTH : 0;
}
