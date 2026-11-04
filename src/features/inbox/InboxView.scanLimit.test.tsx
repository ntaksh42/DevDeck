import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { resetAgentPanelState } from "@/components/agent/agentPanelStore";
import { resetDemoInbox } from "@/lib/demo/actionInbox";
import * as commands from "@/lib/azdoCommands";
import { openList, renderView } from "./inboxViewTestUtils";

vi.mock("@/lib/openExternal", () => ({ openExternalUrl: vi.fn() }));

beforeEach(() => resetDemoInbox());
afterEach(() => {
  cleanup();
  resetAgentPanelState();
  vi.restoreAllMocks();
});

const state = (scope: string, lastWarning: string | null) => ({
  scope,
  orgId: "org1",
  lastSyncedAt: null,
  errorCount: 0,
  lastError: null,
  lastWarning,
});

describe("Inbox scan limit notice", () => {
  it("shows a notice in the status bar when an Inbox scan was limited", async () => {
    vi.spyOn(commands, "listSyncStates").mockResolvedValue([
      state("inbox_prs:org1", "3 pull requests were not scanned"),
      state("hot:org1", "unrelated warning"),
    ]);
    renderView();
    await openList();
    const notice = await screen.findByText(/Scan limited/);
    expect(notice.getAttribute("title")).toBe("3 pull requests were not scanned");
  });

  it("shows nothing when the scans were complete", async () => {
    vi.spyOn(commands, "listSyncStates").mockResolvedValue([state("inbox_prs:org1", null)]);
    renderView();
    await openList();
    expect(screen.queryByText(/Scan limited/)).toBeNull();
  });
});
