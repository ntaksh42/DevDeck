import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TimelineNode } from "@/lib/azdoCommands";
import { buildTimelineTree } from "./pipelineTimelineTree";

const retryPipelineStage = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  retryPipelineStage: (...args: unknown[]) => retryPipelineStage(...args),
}));

import { PipelineStageRetryPanel } from "./PipelineStageRetryPanel";

function node(overrides: Partial<TimelineNode>): TimelineNode {
  return {
    id: "n",
    parentId: null,
    nodeType: "Stage",
    name: "Stage",
    identifier: null,
    state: "completed",
    result: "succeeded",
    startTime: null,
    finishTime: null,
    logId: null,
    errorCount: 0,
    warningCount: 0,
    order: 1,
    ...overrides,
  };
}

function renderPanel(nodes: TimelineNode[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PipelineStageRetryPanel
        organizationId="contoso"
        projectId="p1"
        buildId={7}
        tree={buildTimelineTree(nodes)}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => retryPipelineStage.mockReset());
afterEach(cleanup);

describe("PipelineStageRetryPanel", () => {
  it("renders nothing when no stage failed", () => {
    const { container } = renderPanel([node({ id: "s", name: "Build", identifier: "Build" })]);
    expect(container.textContent).toBe("");
  });

  it("retries only the failed jobs of a failed stage after confirmation", async () => {
    retryPipelineStage.mockResolvedValue(undefined);
    renderPanel([
      node({ id: "s1", name: "Build", identifier: "Build", result: "succeeded" }),
      node({ id: "s2", name: "Deploy", identifier: "Deploy_Prod", result: "failed", order: 2 }),
    ]);

    expect(screen.getByText("Failed stages (1)")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry failed jobs"));
    // Nothing is sent until the inline confirmation is accepted.
    expect(retryPipelineStage).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").getAttribute("aria-label")).toBe(
      "Retry the failed jobs of stage Deploy in this run?",
    );
    fireEvent.click(screen.getByText("Retry"));

    await vi.waitFor(() =>
      expect(retryPipelineStage).toHaveBeenCalledWith({
        organizationId: "contoso",
        projectId: "p1",
        buildId: 7,
        stageIdentifier: "Deploy_Prod",
        forceRetryAllJobs: false,
      }),
    );
  });

  it("can retry every job, and cancelling the confirmation sends nothing", async () => {
    retryPipelineStage.mockResolvedValue(undefined);
    renderPanel([node({ id: "s", name: "Deploy", identifier: "Deploy", result: "failed" })]);

    fireEvent.click(screen.getByText("Retry all jobs"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(retryPipelineStage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Retry all jobs"));
    fireEvent.click(screen.getByText("Retry"));
    await vi.waitFor(() =>
      expect(retryPipelineStage).toHaveBeenCalledWith(
        expect.objectContaining({ stageIdentifier: "Deploy", forceRetryAllJobs: true }),
      ),
    );
  });

  it("ignores a failed stage that has no identifier to retry by", () => {
    const { container } = renderPanel([node({ id: "s", name: "Deploy", result: "failed" })]);
    expect(container.textContent).toBe("");
  });
});
