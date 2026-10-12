import { useSyncExternalStore } from "react";
import {
  type AgentQuote,
  OPEN_AGENT_PANEL_EVENT,
  TOGGLE_AGENT_PANEL_EVENT,
  type AgentSubject,
  type OpenAgentPanelDetail,
} from "./agentSubject";

// App-wide open/closed state of the Agent panel. The panel shows as a dock
// panel inside the active view's workspace when it has one, else as a drawer
// at the right edge; both read this store.

/** `null` follows the active view's selection; otherwise this subject (or none) is pinned. */
export type SubjectOverride = { subject: AgentSubject | null } | null;

export type AgentPanelState = {
  open: boolean;
  override: SubjectOverride;
  focusAskId: number | null;
  replyRequest: number;
  /** Quoted result text the next new note is about. */
  quote: AgentQuote | null;
  /** Note of the subject item to select and expand. */
  focusNoteId: string | null;
  /** Docked workspaces currently mounted, newest last; the last one hosts the panel. */
  dockHosts: string[];
  /** Views without a dock that still show the panel (as the drawer) until the user opens or closes it. */
  drawerHosts: string[];
  /** Id of the view list attached as context ("This list"); follows the list, so another view starts unattached. */
  listAttached: string | null;
  /** Until the user opens or closes the panel, a docked workspace shows it by default. */
  dockDefault: boolean;
};

// One shared store even when this module is hot-reloaded in development:
// a second copy would split the panel from the docks that host it.
type Store = {
  state: AgentPanelState;
  returnFocus: HTMLElement | null;
  /** Set by an explicit open; the panel focuses its input once when it mounts for it. */
  focusPending: boolean;
  listeners: Set<() => void>;
  windowListeners: boolean;
};
const holder = globalThis as { __devdeckAgentPanel?: Store };
const store: Store = (holder.__devdeckAgentPanel ??= {
  state: { open: false, override: null, focusAskId: null, replyRequest: 0, quote: null, focusNoteId: null, dockHosts: [], drawerHosts: [], listAttached: null, dockDefault: true },
  returnFocus: null,
  focusPending: false,
  listeners: new Set(),
  windowListeners: false,
});

function set(next: Partial<AgentPanelState>): void {
  store.state = { ...store.state, ...next };
  for (const listener of store.listeners) listener();
}

export function useAgentPanelState(): AgentPanelState {
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.state,
  );
}

/** Whether the panel shows: opened by the user, or still on its default in a docked / drawer-default view. */
export function isAgentPanelShown(state: AgentPanelState): boolean {
  return state.open || (state.dockDefault && (state.dockHosts.length > 0 || state.drawerHosts.length > 0));
}

/** True once per explicit open, so a panel shown by default does not take focus. */
export function consumeAgentFocusRequest(): boolean {
  const pending = store.focusPending;
  store.focusPending = false;
  return pending;
}

function remember(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && !active.closest("[data-agent-panel]")) store.returnFocus = active;
}

/** Focuses the panel's input, unfolding it first when it is folded to one line. */
export function focusAgentComposer(): void {
  window.setTimeout(() => {
    const composer = document.querySelector<HTMLElement>("[data-agent-composer]");
    const textarea = composer?.querySelector("textarea");
    if (textarea) textarea.focus();
    else composer?.querySelector("button")?.click();
  }, 0);
}

export function closeAgentPanel(): void {
  // A pending reply request must not carry over to the next opening.
  store.focusPending = false;
  set({ open: false, dockDefault: false, focusAskId: null, replyRequest: 0, quote: null, focusNoteId: null });
  const target = store.returnFocus;
  store.returnFocus = null;
  window.setTimeout(() => {
    if (target?.isConnected) target.focus();
  }, 0);
}

export function setAgentSubjectOverride(override: SubjectOverride): void {
  set({ override });
}

export function clearAgentQuote(): void {
  set({ quote: null });
}

function onOpen(event: Event): void {
  const detail = (event as CustomEvent<OpenAgentPanelDetail>).detail ?? {};
  remember();
  // Already shown: it is focused below, and a later mount must not focus again.
  store.focusPending = !isAgentPanelShown(store.state);
  set({
    open: true,
    dockDefault: false,
    // No subject given: follow the selection (the caller's own item).
    override: detail.subject !== undefined ? { subject: detail.subject } : null,
    focusAskId: detail.askId ?? null,
    quote: detail.quote ?? null,
    focusNoteId: detail.noteId ?? null,
    replyRequest: detail.reply ? store.state.replyRequest + 1 : store.state.replyRequest,
  });
  // Already open: move focus back into it.
  focusAgentComposer();
}

function onToggle(): void {
  if (isAgentPanelShown(store.state)) {
    closeAgentPanel();
    return;
  }
  remember();
  store.focusPending = true;
  // A fresh open follows the selection again.
  set({ open: true, dockDefault: false, override: null, focusAskId: null, replyRequest: 0, quote: null, focusNoteId: null });
}

if (typeof window !== "undefined" && !store.windowListeners) {
  store.windowListeners = true;
  window.addEventListener(OPEN_AGENT_PANEL_EVENT, onOpen);
  window.addEventListener(TOGGLE_AGENT_PANEL_EVENT, onToggle);
}

/** A docked workspace offers itself as the panel's home while mounted. */
export function registerDockHost(id: string): () => void {
  set({ dockHosts: [...store.state.dockHosts.filter((host) => host !== id), id] });
  return () => set({ dockHosts: store.state.dockHosts.filter((host) => host !== id) });
}

/** A view without a dock asks for the drawer to show by default while it is mounted. */
export function registerDrawerHost(id: string): () => void {
  set({ drawerHosts: [...store.state.drawerHosts.filter((host) => host !== id), id] });
  return () => set({ drawerHosts: store.state.drawerHosts.filter((host) => host !== id) });
}

/** Attach (the list's id) or detach (`null`) the view's list as context. */
export function setAgentListAttached(listAttached: string | null): void {
  set({ listAttached });
}

/** Test helper: back to the initial state. */
export function resetAgentPanelState(): void {
  store.returnFocus = null;
  store.focusPending = false;
  set({
    open: false,
    override: null,
    focusAskId: null,
    replyRequest: 0,
    quote: null,
    focusNoteId: null,
    dockHosts: [],
    drawerHosts: [],
    listAttached: null,
    dockDefault: true,
  });
}
