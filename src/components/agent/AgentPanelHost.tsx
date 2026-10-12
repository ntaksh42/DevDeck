import { AgentPanel } from "./AgentPanel";
import {
  clearAgentQuote,
  closeAgentPanel,
  isAgentPanelShown,
  setAgentListAttached,
  setAgentSubjectOverride,
  useAgentPanelState,
} from "./agentPanelStore";

/** The Agent panel wired to the app-wide store, for a dock panel or the drawer. */
export function AgentPanelContent({ docked = false }: { docked?: boolean }) {
  const state = useAgentPanelState();
  return (
    <AgentPanel
      docked={docked}
      override={state.override}
      onOverrideChange={setAgentSubjectOverride}
      listAttached={state.listAttached}
      onListAttachedChange={setAgentListAttached}
      focusAskId={state.focusAskId}
      replyRequest={state.replyRequest}
      quote={state.quote}
      focusNoteId={state.focusNoteId}
      onClearQuote={clearAgentQuote}
      onClose={closeAgentPanel}
    />
  );
}

/**
 * The drawer at the right edge, for views without a docked workspace. Views
 * with one host the panel as a dock panel instead (`useAgentDock`), where it
 * can be dragged, split and tabbed like any other panel.
 */
export function AgentPanelHost() {
  const state = useAgentPanelState();
  if (!isAgentPanelShown(state) || state.dockHosts.length > 0) return null;
  return <AgentPanelContent />;
}
