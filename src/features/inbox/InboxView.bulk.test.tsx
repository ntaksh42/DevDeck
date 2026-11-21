import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { openList, renderView, storedRows } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => {
  resetDemoInbox();
});

afterEach(() => {
  cleanup();
  resetAgentPanelState();
});

describe("InboxView bulk actions", () => {
  it("marks a range with Shift+Down, finishes it with e and restores it with u", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(storedRows(list)[0]);
    fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true });
    expect(screen.getByText(/3 marked/)).toBeTruthy();

    fireEvent.keyDown(list, { key: "e" });
    await waitFor(() => expect(storedRows(list)).toHaveLength(1));
    expect(screen.getByText("Marked done (3)")).toBeTruthy();
    expect(screen.queryByText(/marked \(Esc/)).toBeNull();

    fireEvent.keyDown(list, { key: "u" });
    await waitFor(() => expect(storedRows(list)).toHaveLength(4));
  });

  it("toggles a mark with x and clears marks with Escape", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(storedRows(list)[1]);
    fireEvent.keyDown(list, { key: "x" });
    expect(screen.getByText(/1 marked/)).toBeTruthy();
    fireEvent.keyDown(list, { key: "x" });
    expect(screen.queryByText(/marked/)).toBeNull();
    fireEvent.keyDown(list, { key: "x" });
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByText(/marked/)).toBeNull();
    expect(storedRows(list)).toHaveLength(4);
  });
});
