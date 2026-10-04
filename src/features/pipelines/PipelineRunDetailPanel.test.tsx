import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineRunDetail, TimelineNode } from "@/lib/azdoCommands";
import { PipelineRunDetailPanel } from "./PipelineRunDetailPanel";

const getPipelineRun = vi.fn();
const getPipelineRunLogTail = vi.fn();
const rerunPipelineRun = vi.fn();
const cancelPipelineRun = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    getAppSettings: async () => ({ readOnlyValidationModeEnabled: false }),
    getPipelineRun: (...args: unknown[]) => getPipelineRun(...args),
    getPipelineRunLogTail: (...args: unknown[]) => getPipelineRunLogTail(...args),
    listPipelineArtifacts: async () => [],
    rerunPipelineRun: (...args: unknown[]) => rerunPipelineRun(...args),
    cancelPipelineRun: (...args: unknown[]) => cancelPipelineRun(...args),
  };
});

function node(partial: Partial<TimelineNode> & { id: string }): TimelineNode {
  return {
    parentId: null,
    nodeType: "Task",
    name: partial.id,
    state: "completed",
    result: "succeeded",
    startTime: null,
    finishTime: null,
    logId: null,
    errorCount: 0,
    warningCount: 0,
    order: 1,
    ...partial,
  };
}

function detail(status: string, result: string | null): PipelineRunDetail {
  return {
    run: {
      organizationId: "contoso",
      projectId: "p1",
      projectName: "Project",
      buildId: 7,
      buildNumber: "20260613.7",
      definitionId: 1,
      definitionName: "CI",
      status,
      result,
      sourceBranch: "refs/heads/main",
      reason: "individualCI",
      requestedFor: "Demo User",
      queueTime: "2026-06-13T09:00:00Z",
      startTime: "2026-06-13T09:00:05Z",
      finishTime: status === "completed" ? "2026-06-13T09:04:00Z" : null,
      webUrl: "https://dev.azure.com/contoso/p1/_build/results?buildId=7",
    },
    timelineUnavailable: false,
    timeline: [
      node({ id: "stage", nodeType: "Stage", name: "Build", result: "failed", order: 1 }),
      node({ id: "ok-job", parentId: "stage", nodeType: "Job", name: "Setup", logId: 1, order: 1 }),
      node({ id: "ok-task", parentId: "ok-job", name: "Checkout", logId: 2, order: 1 }),
      node({ id: "bad-job", parentId: "stage", nodeType: "Job", name: "Publish", result: "failed", logId: 3, order: 2 }),
      node({ id: "bad-task", parentId: "bad-job", name: "Push to registry", result: "failed", logId: 4, errorCount: 1, order: 1 }),
    ],
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PipelineRunDetailPanel organizationId="contoso" projectId="p1" buildId={7} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPipelineRun.mockResolvedValue(detail("completed", "failed"));
  getPipelineRunLogTail.mockImplementation(async (input: { logId: number }) => ({
    lines: input.logId === 4 ? ["##[error]unauthorized", "0 errors in lint"] : ["ok"],
    truncated: false,
  }));
  rerunPipelineRun.mockResolvedValue({});
  cancelPipelineRun.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PipelineRunDetailPanel", () => {
  it("opens the first failed step's log and folds the branches that succeeded", async () => {
    renderPanel();

    // The deepest failed step is selected without any click.
    await screen.findByText(/Log — Push to registry/i);
    expect(await screen.findByText("##[error]unauthorized")).toBeTruthy();
    expect(getPipelineRunLogTail).toHaveBeenCalledWith(expect.objectContaining({ logId: 4 }));

    const tree = screen.getByRole("tree", { name: "Run timeline" });
    expect(within(tree).getByRole("treeitem", { name: /Push to registry/ })).toBeTruthy();
    // The successful Setup job stays folded: its task is not rendered.
    expect(within(tree).queryByRole("treeitem", { name: /Checkout/ })).toBeNull();
  });

  it("does not paint prose like '0 errors' as an error line", async () => {
    renderPanel();
    const prose = await screen.findByText("0 errors in lint");
    expect(prose.closest("div[data-line]")?.className).not.toContain("text-red-400");
  });

  it("expands and collapses with the arrow keys", async () => {
    renderPanel();
    const setup = await screen.findByRole("treeitem", { name: /Setup/ });

    setup.focus();
    fireEvent.keyDown(setup, { key: "ArrowRight" });
    expect(await screen.findByRole("treeitem", { name: /Checkout/ })).toBeTruthy();

    fireEvent.keyDown(setup, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.queryByRole("treeitem", { name: /Checkout/ })).toBeNull());
  });

  it("asks inline before re-running and returns focus to the Re-run button on Escape", async () => {
    renderPanel();
    const tree = await screen.findByRole("tree", { name: "Run timeline" });

    fireEvent.keyDown(within(tree).getAllByRole("treeitem")[0], { key: "r" });

    const bar = await screen.findByRole("alertdialog");
    expect(within(bar).getByText(/Queue a new run of CI on main\?/)).toBeTruthy();
    // Focus starts on the safe choice.
    expect(document.activeElement).toBe(within(bar).getByRole("button", { name: "Cancel" }));
    expect(rerunPipelineRun).not.toHaveBeenCalled();

    fireEvent.keyDown(bar, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Re-run" })));
    expect(rerunPipelineRun).not.toHaveBeenCalled();
  });

  it("re-runs only after the inline confirmation", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Re-run" }));

    const bar = await screen.findByRole("alertdialog");
    fireEvent.click(within(bar).getByRole("button", { name: "Re-run" }));

    await waitFor(() =>
      expect(rerunPipelineRun).toHaveBeenCalledWith(
        expect.objectContaining({ definitionId: 1, sourceBranch: "refs/heads/main" }),
      ),
    );
  });

  it("offers Cancel only while the run is in progress", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Re-run" });
    expect(screen.queryByRole("button", { name: "Cancel run" })).toBeNull();
    cleanup();

    getPipelineRun.mockResolvedValue(detail("inProgress", null));
    renderPanel();
    const cancel = await screen.findByRole("button", { name: "Cancel run" });
    fireEvent.click(cancel);
    const bar = await screen.findByRole("alertdialog");
    expect(within(bar).getByText("Cancel this run?")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(cancelPipelineRun).toHaveBeenCalledTimes(1));
  });

  it("searches the log and steps through matches", async () => {
    renderPanel();
    await screen.findByText("##[error]unauthorized");

    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    const input = await screen.findByRole("textbox", { name: "Search log" });
    fireEvent.change(input, { target: { value: "error" } });
    // "##[error]unauthorized" and "0 errors in lint" both contain "error".
    expect(await screen.findByText("1/2")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("2/2")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Search log" })).toBeNull());
  });
});
