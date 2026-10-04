import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PipelineTestResults } from "@/lib/azdoCommands";

const listPipelineTestResults = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listPipelineTestResults: (...args: unknown[]) => listPipelineTestResults(...args),
}));

import { PipelineTestResultsPanel } from "./PipelineTestResultsPanel";

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PipelineTestResultsPanel organizationId="contoso" projectId="p1" buildId={7} />
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
});
