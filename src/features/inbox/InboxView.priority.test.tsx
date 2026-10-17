import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { demoListInboxItems, resetDemoInbox } from "@/lib/demo/actionInbox";
import { openList, renderView, rowFor, storedRows } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => resetDemoInbox());
afterEach(() => { cleanup(); resetAgentPanelState(); });

const priorityButton = (name: string) => screen.getByRole("radio", { name });

describe("Inbox priority", () => {
  it("classifies conversations by mentions, including a mention followed by a general reply", async () => {
    renderView();
    const list = await openList();
    expect(priorityButton("All").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(priorityButton("Priority"));
    expect(storedRows(list)).toHaveLength(3);
    expect(rowFor(list, "!42 azdo-dashboard").textContent).toContain("null 扱いの補足");
    expect(rowFor(list, "#123")).toBeTruthy();
    fireEvent.click(priorityButton("Other"));
    expect(storedRows(list)).toHaveLength(1);
    expect(rowFor(list, "!103 api-gateway")).toBeTruthy();
    fireEvent.click(priorityButton("All"));
    expect(storedRows(list)).toHaveLength(4);
    expect(demoListInboxItems({ state: "done" })).toHaveLength(0);
  });

  it("drops hidden marks so Done and Undo only change visible conversations", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!103 api-gateway"));
    fireEvent.keyDown(list, { key: "x" });
    fireEvent.click(priorityButton("Priority"));
    expect(screen.queryByText(/marked \(Esc/)).toBeNull();
    fireEvent.keyDown(priorityButton("Priority"), { key: "Enter" });
    fireEvent.keyDown(list, { key: "e" });
    await waitFor(() => expect(storedRows(list)).toHaveLength(2));
    expect(demoListInboxItems({ state: "open" }).some((entry) => entry.id === 4)).toBe(true);
    await waitFor(() => expect(demoListInboxItems({ state: "done" })).toHaveLength(1));
    await screen.findByRole("button", { name: "Done 1" });
    fireEvent.keyDown(list, { key: "u" });
    await waitFor(() => expect(storedRows(list)).toHaveLength(3));
    await screen.findByRole("button", { name: "Done 0" });
    fireEvent.click(priorityButton("All"));
    await waitFor(() => expect(storedRows(list)).toHaveLength(4));
  });

  it("supports keyboard switching, row navigation and filtering Done without changing hidden items", async () => {
    renderView();
    const list = await openList();
    priorityButton("All").focus();
    fireEvent.keyDown(priorityButton("All"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(priorityButton("Priority"));
    expect(storedRows(list)).toHaveLength(3);
    fireEvent.keyDown(priorityButton("Priority"), { key: "Enter" });
    await waitFor(() => expect(list.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "e" });
    await waitFor(() => expect(storedRows(list)).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^Done \d/ }));
    await waitFor(() => expect(storedRows(list)).toHaveLength(1));
    fireEvent.keyDown(priorityButton("Priority"), { key: "ArrowRight" });
    expect(storedRows(list)).toHaveLength(0);
    expect(screen.getByText("No items match the filter.")).toBeTruthy();
    expect(demoListInboxItems({ state: "done" })).toHaveLength(1);
  });
});
