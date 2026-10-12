import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PipelineRunSummary } from "@/lib/azdoCommands";
import { PipelineRunsGrid } from "./PipelineRunsGrid";

function run(buildId: number): PipelineRunSummary {
  return {
    organizationId: "contoso",
    projectId: "p1",
    projectName: "Project",
    buildId,
    buildNumber: `20260613.${buildId}`,
    definitionId: 1,
    definitionName: "CI",
    status: "completed",
    result: "succeeded",
    sourceBranch: "refs/heads/main",
    reason: "individualCI",
    requestedFor: "Demo User",
    queueTime: "2026-06-13T09:00:00Z",
    startTime: "2026-06-13T09:00:05Z",
    finishTime: "2026-06-13T09:04:00Z",
    webUrl: `https://dev.azure.com/contoso/p1/_build/results?buildId=${buildId}`,
  };
}

function renderGrid(onSelectRun = vi.fn()) {
  render(
    <>
      <PipelineRunsGrid
        label="Runs"
        runs={[run(1), run(2)]}
        definitionId={1}
        selectedBuildId={null}
        isPrimary={false}
        wide={false}
        onSelectRun={onSelectRun}
      />
      <div data-primary-preview="true" tabIndex={-1} data-testid="preview" />
    </>,
  );
  return onSelectRun;
}

describe("PipelineRunsGrid keyboard", () => {
  afterEach(cleanup);

  it.each(["Enter"])("%s selects the run and focuses the preview", async (key) => {
    const onSelectRun = renderGrid();
    const rows = screen.getAllByRole("row");
    rows[1].focus();
    fireEvent.keyDown(rows[1], { key });
    expect(onSelectRun).toHaveBeenCalledWith(expect.objectContaining({ buildId: 2, definitionId: 1 }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("preview")));
  });
});
