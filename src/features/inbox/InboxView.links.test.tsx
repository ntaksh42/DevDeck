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
  it("lists a pull request's linked work items above the conversation", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    const links = await screen.findByRole("region", { name: "Related links" });
    await waitFor(() => {
      expect(within(links).getByRole("button", { name: /#123/ })).toBeTruthy();
      expect(within(links).getByRole("button", { name: /#118/ })).toBeTruthy();
    });
    expect(within(links).getByText("Linked")).toBeTruthy();
    // Above the thread, so the pinned reply box never covers it.
    const thread = await screen.findByText("Could you add a test for the empty case?");
    expect(links.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists a work item's parent and opens a link with its number key", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "#123"));
    const links = await screen.findByRole("region", { name: "Related links" });
    expect(within(links).getByRole("button", { name: /#90/ })).toBeTruthy();

    const opened = vi.fn();
    window.addEventListener(NAVIGATE_WORK_ITEM_EVENT, opened);
    fireEvent.keyDown(list, { key: "1" });
    window.removeEventListener(NAVIGATE_WORK_ITEM_EVENT, opened);
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
