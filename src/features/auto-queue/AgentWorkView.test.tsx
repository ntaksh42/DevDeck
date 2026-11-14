import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NAVIGATE_PULL_REQUEST_EVENT } from "@/lib/crossLinks";
import { OPEN_AGENT_PANEL_EVENT } from "@/components/agent/agentSubject";
import { resetDemoAgentWork } from "@/lib/demo/agentWork";
import { openExternalUrl } from "@/lib/openExternal";
import { AgentWorkView } from "./AgentWorkView";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn(), openLocalPath: vi.fn() }));

// The view reads the browser demo's Agent Work: !42 running, !99 waiting,
// !103 failed, !189 and #123 done, !101 partial, #118 excluded.

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<AgentWorkView />, { wrapper });
}

async function list(name: string) {
  const listbox = await screen.findByRole("listbox", { name: `${name} agent work` });
  await waitFor(() => expect(document.activeElement).toBe(listbox));
  return listbox;
}

beforeEach(() => {
  resetDemoAgentWork();
  window.localStorage.clear();
  vi.mocked(openExternalUrl).mockReset();
});
afterEach(cleanup);

describe("AgentWorkView", () => {
  it("opens on what needs attention and switches tabs with number keys", async () => {
    mount();
    const attention = await list("Needs attention");
    expect(within(attention).getByRole("option", { name: /!103/ })).toBeTruthy();
    expect(within(attention).getByRole("option", { name: /!101/ })).toBeTruthy();
    expect(screen.getByText("Automatic review timed out")).toBeTruthy();

    fireEvent.keyDown(attention, { key: "2" });
    const active = await list("Active");
    expect(within(active).getByRole("option", { name: /!42/ })).toBeTruthy();
    expect(within(active).getByRole("option", { name: /!99/ })).toBeTruthy();
  });

  it("switches tabs with the arrows in the tab-strip segments and returns to the list with Enter", async () => {
    mount();
    await list("Needs attention");
    const attentionTab = await screen.findByRole("tab", { name: /Needs attention/ });
    attentionTab.focus();
    fireEvent.keyDown(attentionTab, { key: "ArrowRight" });
    const activeTab = await screen.findByRole("tab", { name: /^Active/, selected: true });
    await waitFor(() => expect(document.activeElement).toBe(activeTab));
    expect(within(await screen.findByRole("listbox", { name: "Active agent work" })).getByRole("option", { name: /!42/ })).toBeTruthy();

    fireEvent.keyDown(activeTab, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("listbox", { name: "Active agent work" })));
  });

  it("retries a failed item with R", async () => {
    mount();
    const attention = await list("Needs attention");
    fireEvent.keyDown(attention, { key: "r" });
    await waitFor(() => expect(within(attention).queryByRole("option", { name: /!103/ })).toBeNull());
    fireEvent.keyDown(attention, { key: "2" });
    expect(within(await list("Active")).getByRole("option", { name: /!103/ })).toBeTruthy();
  });

  it("opens the item in DevDeck with O and on Azure DevOps with Shift+O", async () => {
    mount();
    const attention = await list("Needs attention");
    const navigated = vi.fn();
    window.addEventListener(NAVIGATE_PULL_REQUEST_EVENT, navigated);
    fireEvent.keyDown(attention, { key: "o" });
    window.removeEventListener(NAVIGATE_PULL_REQUEST_EVENT, navigated);
    expect((navigated.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      pullRequestId: 103,
      repositoryId: "azdo-dashboard",
    });
    fireEvent.keyDown(attention, { key: "O", shiftKey: true });
    expect(openExternalUrl).toHaveBeenCalledWith("https://dev.azure.com/contoso/platform/_git/azdo-dashboard/pullrequest/103");
  });

  it("asks the agent about the selected item with Q", async () => {
    mount();
    const attention = await list("Needs attention");
    const opened = vi.fn();
    window.addEventListener(OPEN_AGENT_PANEL_EVENT, opened);
    fireEvent.keyDown(attention, { key: "q" });
    window.removeEventListener(OPEN_AGENT_PANEL_EVENT, opened);
    expect((opened.mock.calls[0][0] as CustomEvent).detail.subject).toMatchObject({
      kind: "pull-request",
      id: 103,
      projectId: "platform",
      repositoryId: "azdo-dashboard",
    });
  });

  it("excludes with X and includes again from the Excluded tab with U", async () => {
    mount();
    const attention = await list("Needs attention");
    fireEvent.keyDown(attention, { key: "x" });
    fireEvent.keyDown(attention, { key: "4" });
    const excluded = await list("Excluded");
    await waitFor(() => expect(within(excluded).getByRole("option", { name: /!103/ })).toBeTruthy());
    expect(within(excluded).getByRole("option", { name: /#118/ })).toBeTruthy();
    fireEvent.click(within(excluded).getByRole("option", { name: /#118/ }));
    fireEvent.keyDown(excluded, { key: "u" });
    await waitFor(() => expect(within(excluded).queryByRole("option", { name: /#118/ })).toBeNull());
  });

  it("counts unread results and marks one read when it is shown", async () => {
    mount();
    await list("Needs attention");
    expect(await screen.findByRole("tab", { name: /Results\s*2 \(2 new\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Results/ }));
    await list("Results");
    await waitFor(() => expect(screen.getByRole("tab", { name: /Results\s*2 \(1 new\)/ })).toBeTruthy());
  });
});
