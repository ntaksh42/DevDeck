import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { snippetLines } from "./InboxCodeSnippet";
import { approvalRows, openList, renderView, rowFor } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => {
  resetDemoInbox();
});

afterEach(() => {
  cleanup();
  resetAgentPanelState();
});

describe("snippetLines", () => {
  it("takes five lines either side, clamped to the file", () => {
    const content = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    expect(snippetLines(content, 10).map((row) => row.number)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(snippetLines(content, 2).map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const end = snippetLines(content, 19);
    expect(end[end.length - 1]).toEqual({ number: 20, text: "line 20" });
  });
});

describe("InboxView context", () => {
  it("labels a code comment's row with its file and line", async () => {
    renderView();
    const list = await openList();
    expect(rowFor(list, "!42").textContent).toContain("dashboard.ts:7");
  });

  it("shows the commented code, the PR summary and the open conversations", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const context = await screen.findByRole("region", { name: "Context" });
    const commented = await waitFor(() => {
      const row = context.querySelector('[data-commented-line="true"]');
      expect(row).not.toBeNull();
      return row as HTMLElement;
    });
    expect(commented.textContent).toContain("7");
    expect(commented.textContent).toContain("options.refreshIntervalMs ?? 30000");
    expect(within(context).getByText("/src/app/dashboard.ts")).toBeTruthy();
    expect(within(context).getByText(/open conversations? in the PR/)).toBeTruthy();
  });

  it("lists what was pushed to a returned pull request", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!210"));
    const context = await screen.findByRole("region", { name: "Context" });
    expect(await within(context).findByText("Make the refresh interval configurable")).toBeTruthy();
    expect(within(context).getByText(/changed files? in the PR/)).toBeTruthy();
  });

  it("shows a work item's parent and expands its description with d", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "#123"));
    const context = await screen.findByRole("region", { name: "Context" });
    expect(await within(context).findByText(/Parent: #90/)).toBeTruthy();
    const toggle = within(context).getByRole("button", { name: /More/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(list, { key: "d" });
    await waitFor(() => expect(within(context).getByRole("button", { name: /Less/ }).getAttribute("aria-expanded")).toBe("true"));
  });

  it("names the pipeline run an approval waits on", async () => {
    renderView();
    const list = await openList();
    const [approval] = await approvalRows(list);
    fireEvent.click(approval);
    expect(await screen.findByText("web-deploy · 20260527.3")).toBeTruthy();
  });
});
