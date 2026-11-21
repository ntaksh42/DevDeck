import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NAVIGATE_PULL_REQUEST_EVENT } from "@/lib/crossLinks";
import { OPEN_AGENT_PANEL_EVENT } from "@/components/agent/agentSubject";
import type { AgentWorkEntry } from "@/lib/azdoCommands";
import { resetDemoAgentWork } from "@/lib/demo/agentWork";
import { openExternalUrl } from "@/lib/openExternal";
import { AgentWorkView } from "./AgentWorkView";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn(), openLocalPath: vi.fn() }));

// The view reads the browser demo's Agent Work: !42 running, !99 waiting,
// !103 failed, !189 and #123 done, !101 partial, #118 excluded.

function mount(entries?: AgentWorkEntry[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: entries ? Infinity : 0 } } });
  if (entries) client.setQueryData(["agentWork"], entries);
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

// Candidates is the first tab; the tests that look at runs switch to Runs.
async function openRuns() {
  mount();
  fireEvent.click(await screen.findByRole("tab", { name: /^Runs/ }));
  return list("Runs");
}

beforeEach(() => {
  resetDemoAgentWork();
  window.localStorage.clear();
  vi.mocked(openExternalUrl).mockReset();
});
afterEach(cleanup);

describe("AgentWorkView", () => {
  it("opens on Candidates and switches to Runs with 2 and back with the tab-strip arrows", async () => {
    mount();
    await screen.findByRole("listbox", { name: "Auto queue candidates" });
    expect(await screen.findByRole("tab", { name: /^Candidates/, selected: true })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Auto queue candidates" }), { key: "2" });
    const runs = await list("Runs");
    expect(runs).toBeTruthy();
    const runsTab = screen.getByRole("tab", { name: /^Runs/, selected: true });
    runsTab.focus();
    fireEvent.keyDown(runsTab, { key: "ArrowLeft" });
    const candidates = await screen.findByRole("tab", { name: /^Candidates/, selected: true });
    await waitFor(() => expect(document.activeElement).toBe(candidates));
    fireEvent.keyDown(candidates, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("listbox", { name: "Auto queue candidates" })));
  });

  it("lists open runs with what needs attention first and keeps Done out of it", async () => {
    const runs = await openRuns();
    const ids = within(runs)
      .getAllByRole("option")
      .map((option) => /[!#]\d+/.exec(option.textContent ?? "")?.[0]);
    // failed, partial, running, waiting, and the excluded one last. !189 and #123 are done.
    expect(ids).toEqual(["!103", "!101", "!42", "!99", "#118"]);
    expect(within(runs).getByRole("option", { name: /#118.*\(excluded\)/ })).toBeTruthy();
    expect(screen.getByText("Automatic review timed out")).toBeTruthy();
  });

  it("shows the Done runs with D and leaves that view with Escape", async () => {
    const runs = await openRuns();
    fireEvent.keyDown(runs, { key: "d" });
    await waitFor(() => expect(within(runs).getByRole("option", { name: /!189/ })).toBeTruthy());
    expect(within(runs).getByRole("option", { name: /#123/ })).toBeTruthy();
    expect(within(runs).queryByRole("option", { name: /!103/ })).toBeNull();
    fireEvent.keyDown(runs, { key: "Escape" });
    await waitFor(() => expect(within(runs).getByRole("option", { name: /!103/ })).toBeTruthy());
    expect(within(runs).queryByRole("option", { name: /!189/ })).toBeNull();
  });

  it("counts the open runs and those that need attention in the tab", async () => {
    mount();
    const tab = await screen.findByRole("tab", { name: /^Runs/ });
    expect(tab.textContent).toBe("Runs 5 · 2 need attention");
  });

  it("retries a failed item with R", async () => {
    const runs = await openRuns();
    fireEvent.keyDown(runs, { key: "r" });
    await waitFor(() => expect(within(runs).getByRole("option", { name: /!103/ }).textContent).toMatch(/Waiting|Running/));
  });

  it("opens the item in DevDeck with O and on Azure DevOps with Shift+O", async () => {
    const runs = await openRuns();
    const navigated = vi.fn();
    window.addEventListener(NAVIGATE_PULL_REQUEST_EVENT, navigated);
    fireEvent.keyDown(runs, { key: "o" });
    window.removeEventListener(NAVIGATE_PULL_REQUEST_EVENT, navigated);
    expect((navigated.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      pullRequestId: 103,
      repositoryId: "azdo-dashboard",
    });
    fireEvent.keyDown(runs, { key: "O", shiftKey: true });
    expect(openExternalUrl).toHaveBeenCalledWith("https://dev.azure.com/contoso/platform/_git/azdo-dashboard/pullrequest/103");
  });

  it("asks the agent about the selected item with Q", async () => {
    const runs = await openRuns();
    const opened = vi.fn();
    window.addEventListener(OPEN_AGENT_PANEL_EVENT, opened);
    fireEvent.keyDown(runs, { key: "q" });
    window.removeEventListener(OPEN_AGENT_PANEL_EVENT, opened);
    expect((opened.mock.calls[0][0] as CustomEvent).detail.subject).toMatchObject({
      kind: "pull-request",
      id: 103,
      projectId: "platform",
      repositoryId: "azdo-dashboard",
    });
  });

  it("excludes with X and includes again with X on an excluded row", async () => {
    const runs = await openRuns();
    fireEvent.keyDown(runs, { key: "x" });
    await waitFor(() => expect(within(runs).getByRole("option", { name: /!103.*\(excluded\)/ })).toBeTruthy());
    fireEvent.click(within(runs).getByRole("option", { name: /#118/ }));
    fireEvent.keyDown(runs, { key: "x" });
    await waitFor(() => expect(within(runs).queryByRole("option", { name: /#118.*\(excluded\)/ })).toBeNull());
  });
});

it("opens the tracked pipeline request and exposes its failure on the keyboard path", async () => {
  mount([{
    organizationId: "contoso",
    organizationName: "Contoso",
    target: "pipeline",
    id: 42,
    scopeId: "platform",
    projectId: "platform",
    title: "CI build",
    scope: "Platform",
    webUrl: "https://dev.azure.com/contoso/platform/_build/results?buildId=42",
    status: "failed",
    excluded: false,
    startedAt: "2026-10-31T00:00:00Z",
    finishedAt: "2026-10-31T00:01:00Z",
    failures: 1,
    nextRetryAt: null,
    error: "Agent exited with status 1",
    exitCode: 1,
    hasLog: false,
    askId: 42_000,
  }]);
  fireEvent.keyDown(await screen.findByRole("listbox", { name: "Auto queue candidates" }), { key: "2" });
  const runs = await list("Runs");
  expect(within(runs).getByRole("option", { name: /CI.*42.*CI build/ })).toBeTruthy();
  expect(screen.getByText("Agent exited with status 1")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Retry now/ })).toBeTruthy();
  const opened = vi.fn();
  window.addEventListener(OPEN_AGENT_PANEL_EVENT, opened, { once: true });
  fireEvent.keyDown(runs, { key: "q" });
  expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ askId: 42_000 });
});
