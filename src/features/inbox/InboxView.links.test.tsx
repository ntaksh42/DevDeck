import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { NAVIGATE_WORK_ITEM_EVENT } from "@/lib/crossLinks";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { openList, renderView, rowFor } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => {
  resetDemoInbox();
});

afterEach(() => {
  cleanup();
  resetAgentPanelState();
});

describe("InboxView related links", () => {
  it("folds a pull request's links to one line under the conversation and opens them", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const links = await screen.findByRole("region", { name: "Related links" });
    expect(within(links).queryByRole("button", { name: /#123/ })).toBeNull();
    fireEvent.click(within(links).getByRole("button", { name: /Linked/ }));
    await waitFor(() => {
      expect(within(links).getByRole("button", { name: /#123/ })).toBeTruthy();
      expect(within(links).getByRole("button", { name: /#118/ })).toBeTruthy();
    });
    expect(within(links).getByText("Linked")).toBeTruthy();
    // After the thread, so the comment is the first thing to read.
    const thread = await screen.findByText("Could you add a test for the empty case?");
    expect(thread.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists a work item's parent and opens a link with its number key", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "#123"));
    const links = await screen.findByRole("region", { name: "Related links" });
    fireEvent.click(within(links).getAllByRole("button")[0]);
    expect(within(links).getByRole("button", { name: /#90/ })).toBeTruthy();

    const opened = vi.fn();
    window.addEventListener(NAVIGATE_WORK_ITEM_EVENT, opened);
    fireEvent.keyDown(list, { key: "1" });
    window.removeEventListener(NAVIGATE_WORK_ITEM_EVENT, opened);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
