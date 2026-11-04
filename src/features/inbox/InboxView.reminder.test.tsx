import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { listReplyReminders } from "@/lib/azdoCommands";
import { openList, renderView, rowFor } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => resetDemoInbox());
afterEach(() => {
  cleanup();
  resetAgentPanelState();
});

describe("Inbox reply reminder (W)", () => {
  it("sets a reminder from the keyboard, then offers to cancel it", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));

    fireEvent.keyDown(list, { key: "w" });
    expect(await screen.findByRole("menu", { name: "Remind if no reply by" })).toBeTruthy();
    // The menu says what clears the reminder.
    expect(screen.getByText(/Cleared when someone comments/)).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Cancel the reminder" })).toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "3" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(async () => {
      const reminders = await listReplyReminders();
      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toMatchObject({ kind: "pr", subjectId: 42, threadId: 1 });
    });
    // The row stays in the list; a reminder does not finish it.
    expect(rowFor(list, "!42")).toBeTruthy();

    fireEvent.keyDown(list, { key: "w" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel the reminder" }));
    await waitFor(async () => expect(await listReplyReminders()).toHaveLength(0));
  });

  it("closes with Escape and returns focus to the list without setting anything", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    fireEvent.keyDown(list, { key: "w" });
    await screen.findByRole("menu", { name: "Remind if no reply by" });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(list.contains(document.activeElement)).toBe(true));
    expect(await listReplyReminders()).toHaveLength(0);
  });
});
