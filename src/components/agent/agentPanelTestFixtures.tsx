import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { AgentPanelHost } from "./AgentPanelHost";
import { buildContextDocument } from "./contextDocument";
import { publishAgentListScope } from "./agentListScope";
import { resetAgentPanelState } from "./agentPanelStore";
import { publishAgentSubject, toggleAgentPanel, type AgentSubject } from "./agentSubject";
import { asks, createAgentNote, deleteAgentNote, replyAgentNote, runAgent, state } from "./agentPanelTestMocks";

export * from "./agentPanelTestMocks";

/** Shared afterEach: unmounts and resets every piece of state the Agent panel tests touch. */
export function resetFixtures() {
  cleanup();
  resetAgentPanelState();
  publishAgentSubject(null);
  publishAgentListScope(null);
  vi.mocked(buildContextDocument).mockClear();
  createAgentNote.mockClear();
  runAgent.mockClear();
  replyAgentNote.mockClear();
  deleteAgentNote.mockClear();
  state.asks = asks;
}

export const pr: AgentSubject = {
  kind: "pull-request",
  id: 68,
  title: "Add ToDo API",
  projectId: "p",
  repositoryId: "r",
  repositoryName: "TestRepos",
  webUrl: null,
};

export function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <button type="button">grid</button>
      <AgentPanelHost />
    </QueryClientProvider>,
  );
}

/** Opens the panel and waits for a conversation: an ask without a subject, or the PR's own note. */
export async function openPanel(conversation = "Why did run 412 fail?") {
  act(() => toggleAgentPanel());
  const panel = await screen.findByRole("complementary", { name: "Agent" });
  await within(panel).findAllByText(conversation);
  return panel;
}
