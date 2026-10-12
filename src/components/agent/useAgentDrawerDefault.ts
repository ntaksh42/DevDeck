import { useEffect, useId } from "react";
import { registerDrawerHost } from "./agentPanelStore";

/**
 * For a view without a docked workspace: shows the Agent panel as the right-edge
 * drawer by default while the view is mounted, as docked views do, until the user
 * opens or closes it (`Ctrl+J`).
 */
export function useAgentDrawerDefault(): void {
  const id = useId();
  useEffect(() => registerDrawerHost(id), [id]);
}
