import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { snippetLines } from "./InboxCodeSnippet";
import { openList, renderView, rowFor } from "./inboxViewTestUtils";

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

  it("shows a work item's parent and expands its description with d", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "#123"));
    expect(await screen.findByText(/Parent: #90/)).toBeTruthy();
    const description = await screen.findByRole("region", { name: "Description" });
    const toggle = within(description).getByRole("button", { name: /Description/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(list, { key: "d" });
    await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
  });

  it("shows Claude's verdict, evidence and reply draft above the conversation", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const notes = await screen.findByRole("region", { name: "Notes by Claude" });
    expect(within(notes).getByText("Fix first")).toBeTruthy();
    expect(within(notes).getAllByText("src/app/dashboard.ts:7").length).toBeGreaterThan(0);
    expect(within(notes).getByText("unverified")).toBeTruthy();
    const thread = await screen.findByText("Could you add a test for the empty case?");
    expect(notes.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Shift+R puts the draft into the reply box, focused, without sending it.
    fireEvent.keyDown(list, { key: "R", shiftKey: true });
    const reply = (await screen.findByPlaceholderText("Reply…")) as HTMLTextAreaElement;
    await waitFor(() => expect(reply.value).toContain("dashboard.test.ts"));
    await waitFor(() => expect(document.activeElement).toBe(reply));
  });

  it("keeps the same frame while the notes are written or when they failed", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!103"));
    expect(within(await screen.findByRole("region", { name: "Notes by Claude" })).getByText(/Looking into/)).toBeTruthy();
    fireEvent.click(rowFor(list, "!189"));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Notes by Claude" }).textContent).toContain("did not finish"),
    );
  });

  it("puts the conversation above the code and folds the PR description as markdown", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const context = await screen.findByRole("region", { name: "Context" });
    const reply = await screen.findByPlaceholderText("Reply…");
    const thread = await screen.findByText("Could you add a test for the empty case?");
    // Comment → code → reply box, so the comment is the first thing to read.
    expect(thread.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(context.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const description = screen.getByRole("region", { name: "Description" });
    expect(description.textContent).not.toContain("## Summary");
    fireEvent.keyDown(list, { key: "d" });
    const heading = await within(description).findByRole("heading", { name: "Summary" });
    expect(heading).toBeTruthy();
  });

});
