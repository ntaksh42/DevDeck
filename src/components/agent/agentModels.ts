import type { AgentKind, AppSettings } from "@/lib/azdoCommands";

/** Models offered for every Claude Code user (its aliases); Codex has none built in. */
const BUILT_IN_MODELS: Record<AgentKind, string[]> = {
  claude: ["opus", "sonnet", "haiku"],
  codex: [],
};

/** The agent's model from Settings; "" leaves it to the agent's own setting. */
export function settingsModel(settings: AppSettings | undefined, agent: AgentKind): string {
  return (agent === "codex" ? settings?.codexModel : settings?.claudeModel) ?? "";
}

/** Models the Agent panel offers for an agent: built-ins, the Settings model, then the extra choices. */
export function modelChoices(settings: AppSettings | undefined, agent: AgentKind): string[] {
  const extra = (agent === "codex" ? settings?.codexModelChoices : settings?.claudeModelChoices) ?? "";
  const listed = extra.split(/[,\s]+/).filter(Boolean);
  return [...new Set([...BUILT_IN_MODELS[agent], settingsModel(settings, agent), ...listed].filter(Boolean))];
}
