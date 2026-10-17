import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import { openList, renderView, rowFor } from "./inboxViewTestUtils";

const generateActionInboxInsight = vi.fn();
let insightEnabled = true;

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    getAppSettings: async () => ({
      ...(await actual.getAppSettings()),
      inboxInsightEnabled: insightEnabled,
    }),
    generateActionInboxInsight: (...args: unknown[]) => generateActionInboxInsight(...args),
  };
});

beforeEach(() => {
  resetDemoInbox();
  insightEnabled = true;
  generateActionInboxInsight.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  resetAgentPanelState();
});

describe("InboxView on-demand notes", () => {
  it("offers Regenerate on a failed item and starts the notes with I", async () => {
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!189"));
    const notes = await screen.findByRole("region", { name: "Notes by Claude" });
    await waitFor(() => expect(notes.textContent).toContain("did not finish"));

    fireEvent.click(within(notes).getByRole("button", { name: /Regenerate/ }));
    expect(generateActionInboxInsight).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(list, { key: "i" });
    expect(generateActionInboxInsight).toHaveBeenCalledTimes(2);
  });

  it("does not offer notes while summaries are off", async () => {
    insightEnabled = false;
    renderView();
    const list = await openList();
    fireEvent.click(rowFor(list, "!189"));
    const notes = await screen.findByRole("region", { name: "Notes by Claude" });
    expect(within(notes).queryByRole("button", { name: /Regenerate/ })).toBeNull();
    fireEvent.keyDown(list, { key: "i" });
    expect(generateActionInboxInsight).not.toHaveBeenCalled();
  });
});
