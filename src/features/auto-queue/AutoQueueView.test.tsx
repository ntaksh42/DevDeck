import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutoQueueView } from "./AutoQueueView";

const item = (id: number, title: string) => ({
  organizationId: "org",
  organizationName: "contoso",
  target: "pull-request" as const,
  id,
  title,
  scope: "repo",
  webUrl: null,
  createdDate: null,
});

const runAutoQueue = vi.fn();
vi.mock("@/lib/azdoCommands", async (original) => ({
  ...(await original<typeof import("@/lib/azdoCommands")>()),
  listAutoQueue: async () => [item(1, "First change"), item(2, "Second change")],
  getAutoQueuePreview: async () => ({ document: "## Changes", chars: 30000, estimatedTokens: 10000, unavailable: null }),
  runAutoQueue: (targets: unknown) => runAutoQueue(targets),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<AutoQueueView />, { wrapper });
}

beforeEach(() => {
  runAutoQueue.mockReset();
  runAutoQueue.mockResolvedValue(1);
  window.localStorage.clear();
});
afterEach(cleanup);

describe("AutoQueueView", () => {
  it("shows the material size of the focused candidate", async () => {
    mount();
    await screen.findByRole("option", { name: /First change/ });
    await waitFor(() => expect(screen.getByText(/30,000 chars/)).toBeTruthy());
  });

  it("runs only the candidates picked with the keyboard", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    await waitFor(() => expect(document.activeElement).toBe(list));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: " " });
    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(runAutoQueue).toHaveBeenCalledWith([{ organizationId: "org", target: "pull-request", id: 2, title: "Second change", scope: "repo", webUrl: null, createdDate: null, organizationName: "contoso" }]),
    );
  });

  it("hides the candidates handed to the agent right away", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    fireEvent.keyDown(list, { key: " " });
    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole("option", { name: /First change/ })).toBeNull());
    expect(screen.getByRole("option", { name: /Second change/ })).toBeTruthy();
  });

  it("hides a skipped candidate and keeps focus on the list", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    fireEvent.keyDown(list, { key: "s" });
    await waitFor(() => expect(screen.queryByRole("option", { name: /First change/ })).toBeNull());
    expect(screen.getByRole("option", { name: /Second change/ })).toBeTruthy();
    expect(document.activeElement).toBe(list);
  });
});
