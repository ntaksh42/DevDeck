import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { openList, renderView, rowFor, storedRows } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => resetDemoInbox());
afterEach(() => { cleanup(); resetAgentPanelState(); });

describe("Inbox column filters", () => {
  it("hides rows of an unchecked Kind value and clears with one button", async () => {
    renderView();
    const list = await openList();
    const kindButton = screen.getByRole("button", { name: "Filter by Kind" });
    fireEvent.click(kindButton);
    fireEvent.click(screen.getByRole("checkbox", { name: "Reply" }));
    await waitFor(() => expect(storedRows(list)).toHaveLength(3));
    expect(() => rowFor(list, "!103 api-gateway")).toThrow();
    expect(screen.getByRole("radio", { name: "All" }).textContent).toBe("All 3");

    fireEvent.click(screen.getByRole("button", { name: "Clear column filters" }));
    await waitFor(() => expect(storedRows(list)).toHaveLength(4));
  });

  it("returns focus to the column button when the dropdown is dismissed with Escape", async () => {
    renderView();
    await openList();
    const kindButton = screen.getByRole("button", { name: "Filter by Kind" });
    kindButton.focus();
    fireEvent.click(kindButton);
    expect(screen.getByPlaceholderText("Search…")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("Search…")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(kindButton));
  });
});
