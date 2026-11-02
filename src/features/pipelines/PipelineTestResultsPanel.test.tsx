import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineTestResults } from "@/lib/azdoCommands";

const listPipelineTestResults = vi.fn();
const listFlakyTests = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listPipelineTestResults: (...args: unknown[]) => listPipelineTestResults(...args),
  listFlakyTests: (...args: unknown[]) => listFlakyTests(...args),
}));

import { PipelineTestResultsPanel } from "./PipelineTestResultsPanel";

function renderPanel(definitionId: number | null = null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PipelineTestResultsPanel
        organizationId="contoso"
        projectId="p1"
        buildId={7}
        definitionId={definitionId}
        sourceBranch="refs/heads/main"
      />
    </QueryClientProvider>,
  );
}

const failing: PipelineTestResults = {
  total: 20,
  passed: 16,
  failed: 3,
  other: 1,
  failedTests: [
    { name: "adds numbers", runName: "Unit", errorMessage: "expected 3", durationMs: 12 },
    { name: "no message", runName: null, errorMessage: null, durationMs: null },
  ],
  truncated: true,
};

beforeEach(() => {
  listPipelineTestResults.mockReset();
  listFlakyTests.mockReset();
});
afterEach(cleanup);

describe("PipelineTestResultsPanel", () => {
  it("shows the summary, failed tests with their errors, and the truncation note", async () => {
    listPipelineTestResults.mockResolvedValue(failing);
    renderPanel();

    expect(await screen.findByText("Tests (20)")).toBeTruthy();
    expect(screen.getByText("16 passed")).toBeTruthy();
    expect(screen.getByText("3 failed")).toBeTruthy();
    expect(screen.getByText("1 skipped / other")).toBeTruthy();
    expect(screen.getByText("adds numbers")).toBeTruthy();
    expect(screen.getByText("expected 3")).toBeTruthy();
    expect(screen.getByText("No error message.")).toBeTruthy();
    expect(screen.getByText("Showing the first 2 of 3 failed tests.")).toBeTruthy();
  });

  it("renders nothing when the build published no tests", async () => {
    listPipelineTestResults.mockResolvedValue({
      total: 0, passed: 0, failed: 0, other: 0, failedTests: [], truncated: false,
    });
    const { container } = renderPanel();

    await vi.waitFor(() => expect(listPipelineTestResults).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("badges failures from the recent-runs comparison and hints at a retry", async () => {
    listPipelineTestResults.mockResolvedValue({ ...failing, failed: 2, truncated: false });
    listFlakyTests.mockResolvedValue({
      comparedRuns: 10,
      skippedRuns: 1,
      tests: [
        { name: "adds numbers", kind: "flaky", failedRuns: 3, observedRuns: 10, sinceBuildId: null, sinceBuildNumber: null },
        { name: "no message", kind: "unstable", failedRuns: 2, observedRuns: 9, sinceBuildId: null, sinceBuildNumber: null },
      ],
    });
    renderPanel(12);

    expect(await screen.findByText("Flaky 3/10")).toBeTruthy();
    expect(screen.getByText("Unstable 2/9")).toBeTruthy();
    expect(screen.getByText(/retrying the failed jobs is likely enough/)).toBeTruthy();
    expect(screen.getByText(/Compared with the last 10 completed runs on this branch \(1 could not be read\)/)).toBeTruthy();
    expect(listFlakyTests).toHaveBeenCalledWith({
      organizationId: "contoso",
      projectId: "p1",
      definitionId: 12,
      branch: "refs/heads/main",
    });
  });

  it("skips the comparison without a definition and survives its failure", async () => {
    listPipelineTestResults.mockResolvedValue(failing);
    renderPanel();
    expect(await screen.findByText("adds numbers")).toBeTruthy();
    expect(listFlakyTests).not.toHaveBeenCalled();

    cleanup();
    listFlakyTests.mockRejectedValue(new Error("403"));
    renderPanel(12);
    await vi.waitFor(() => expect(listFlakyTests).toHaveBeenCalled());
    expect(screen.getByText("adds numbers")).toBeTruthy();
    expect(screen.queryByText(/Flaky/)).toBeNull();
  });
});
