import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutoQueueStartupGate } from "./AutoQueueStartupGate";

const item = (id: number, held: boolean) => ({
  organizationId: "org",
  organizationName: "contoso",
  target: "work-item" as const,
  id,
  title: `Item ${id}`,
  scope: "project",
  webUrl: null,
  createdDate: null,
  held,
});

let queue = [item(1, true)];
vi.mock("@/lib/azdoCommands", async (original) => ({
  ...(await original<typeof import("@/lib/azdoCommands")>()),
  getAppSettings: async () => ({ autoAgentEnabled: true }),
  listAutoQueue: async () => queue,
  getAutoQueuePreview: async () => ({ document: "", chars: 0, estimatedTokens: 0, unavailable: null }),
  runAutoQueue: async () => 1,
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<AutoQueueStartupGate />, { wrapper });
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

// The gate remembers its decision for the rest of the launch, so the case that
// ends in a decision comes last.
describe("AutoQueueStartupGate", () => {
  it("stays out of the way when nothing was held back", async () => {
    queue = [item(1, false)];
    mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("blocks the app until the held items are decided, and Escape does not close it", async () => {
    queue = [item(1, true), item(2, false)];
    mount();
    const dialog = await screen.findByRole("dialog", { name: "Choose what the agent handles" });
    expect(dialog.textContent).toContain("1 found at startup");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip all and continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
