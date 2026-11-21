import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { openList, renderView, rowFor, storedRows } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => {
  resetDemoInbox();
});

afterEach(() => {
  cleanup();
  resetAgentPanelState();
});

describe("InboxView keyboard flow", () => {
  it("selects the next row after e and puts the item back with u", async () => {
    renderView();
    const list = await openList();
    const rows = storedRows(list);
    const nextText = rows[1].textContent ?? "";
    fireEvent.click(rows[0]);
    const firstText = rows[0].textContent ?? "";
    fireEvent.keyDown(list, { key: "e" });

    // The next row takes the selection right away and the list keeps focus.
    await waitFor(() => {
      expect(within(list).getByRole("option", { selected: true }).textContent).toBe(nextText);
    });
    await waitFor(() => expect(document.activeElement).toBe(within(list).getByRole("option", { selected: true })));
    expect(screen.getByText("Marked done")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Done 1" })).toBeTruthy();

    fireEvent.keyDown(list, { key: "u" });
    await waitFor(() => {
      expect(within(list).getByRole("option", { selected: true }).textContent).toBe(firstText);
    });
    expect(storedRows(list)).toHaveLength(4);
    expect(screen.queryByText("Marked done")).toBeNull();
    expect(await screen.findByRole("button", { name: "Done 0" })).toBeTruthy();
  });

  it("resolves and finishes the selected thread with Shift+E", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!189"));
    await screen.findByRole("button", { name: /^Resolve \+ Done/ });
    fireEvent.keyDown(list, { key: "E", shiftKey: true });
    await waitFor(() => {
      expect(storedRows(list).some((row) => row.textContent?.includes("!189"))).toBe(false);
    });
    expect(await screen.findByText("Resolved + done")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Done 1" })).toBeTruthy();
  });

  it("scrolls the preview with Space while the list keeps focus", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!42"));
    await screen.findByRole("heading", { name: /!42/ });
    const preview = document.querySelector<HTMLElement>('[data-primary-preview="true"]')!;
    const scrollBy = vi.fn();
    preview.scrollBy = scrollBy as unknown as typeof preview.scrollBy;
    fireEvent.keyDown(list, { key: " " });
    fireEvent.keyDown(list, { key: " ", shiftKey: true });
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect((scrollBy.mock.calls[0][0] as ScrollToOptions).top).toBeGreaterThan(0);
    expect((scrollBy.mock.calls[1][0] as ScrollToOptions).top).toBeLessThan(0);
  });
});
