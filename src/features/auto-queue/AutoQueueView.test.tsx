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
  scopeId: "repo-id",
  webUrl: null,
  createdDate: null,
});

const runAutoQueue = vi.fn();
const setAgentWorkExcluded = vi.fn();
vi.mock("@/lib/azdoCommands", async (original) => ({
  ...(await original<typeof import("@/lib/azdoCommands")>()),
  listAutoQueue: async () => [item(1, "First change"), item(2, "Second change"), item(3, "Third fix")],
  getAutoQueuePreview: async () => ({ document: "## Changes", chars: 30000, estimatedTokens: 10000, unavailable: null }),
  runAutoQueue: (targets: unknown) => runAutoQueue(targets),
  setAgentWorkExcluded: (target: unknown, excluded: boolean) => setAgentWorkExcluded(target, excluded),
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
  setAgentWorkExcluded.mockReset();
  setAgentWorkExcluded.mockResolvedValue(undefined);
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
      expect(runAutoQueue).toHaveBeenCalledWith([item(2, "Second change")]),
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

  it("excludes a candidate from automatic runs and keeps focus on the list", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    fireEvent.keyDown(list, { key: "x" });
    await waitFor(() => expect(screen.queryByRole("option", { name: /First change/ })).toBeNull());
    expect(setAgentWorkExcluded).toHaveBeenCalledWith(item(1, "First change"), true);
    expect(screen.getByRole("option", { name: /Second change/ })).toBeTruthy();
    expect(document.activeElement).toBe(list);
  });

  it("selects every shown candidate with A and runs them together", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    fireEvent.keyDown(list, { key: "a" });
    expect((screen.getByLabelText("Select all shown") as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(runAutoQueue).toHaveBeenCalledTimes(1));
    expect(runAutoQueue.mock.calls[0][0]).toHaveLength(3);
  });

  it("selects all with the header checkbox and returns focus to the list", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    fireEvent.click(screen.getByLabelText("Select all shown"));
    expect(screen.getByText(/3 selected/)).toBeTruthy();
    expect(document.activeElement).toBe(list);
    fireEvent.click(screen.getByLabelText("Select all shown"));
    expect(screen.getByText(/0 selected/)).toBeTruthy();
  });

  it("filters the list and selects and runs only the candidates shown", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    fireEvent.click(screen.getByRole("button", { name: "Filter candidates" }));
    const input = await screen.findByRole("textbox", { name: "Filter candidates" });
    fireEvent.change(input, { target: { value: "change" } });
    expect(screen.queryByRole("option", { name: /Third fix/ })).toBeNull();
    expect(screen.getByText(/2 of 3 not run yet/)).toBeTruthy();

    fireEvent.keyDown(list, { key: "a" });
    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(runAutoQueue).toHaveBeenCalledTimes(1));
    expect(runAutoQueue.mock.calls[0][0]).toEqual([item(1, "First change"), item(2, "Second change")]);
  });

  it("matches the filter against the number and says when nothing matches", async () => {
    mount();
    await screen.findByRole("option", { name: /First change/ });
    fireEvent.click(screen.getByRole("button", { name: "Filter candidates" }));
    const input = await screen.findByRole("textbox", { name: "Filter candidates" });
    fireEvent.change(input, { target: { value: "!3" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No candidates match the filter.")).toBeTruthy();
  });

  it("opens the filter with / and Escape returns focus to the list", async () => {
    mount();
    const list = await screen.findByRole("listbox", { name: "Auto queue candidates" });
    fireEvent.keyDown(list, { key: "/" });
    const input = await screen.findByRole("textbox", { name: "Filter candidates" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(list));
  });
});
