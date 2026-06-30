import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PipelineTestSummary as PipelineTestSummaryData } from "@/lib/azdoCommands";
import { PipelineTestSummary } from "./PipelineTestSummary";

afterEach(() => {
  cleanup();
});

function summary(overrides: Partial<PipelineTestSummaryData> = {}): PipelineTestSummaryData {
  return {
    runCount: 1,
    totalTests: 128,
    passedTests: 125,
    failedTests: 3,
    failed: [],
    truncated: false,
    ...overrides,
  };
}

describe("PipelineTestSummary", () => {
  it("renders nothing when there are no tests at all", () => {
    const { container } = render(
      <PipelineTestSummary summary={summary({ totalTests: 0, passedTests: 0, failedTests: 0 })} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows pass/fail/total counts", () => {
    render(<PipelineTestSummary summary={summary()} />);
    expect(screen.getByText("125 passed")).toBeTruthy();
    expect(screen.getByText("3 failed")).toBeTruthy();
    expect(screen.getByText("128 total")).toBeTruthy();
  });

  it("lists failed tests with their error messages", () => {
    render(
      <PipelineTestSummary
        summary={summary({
          failed: [
            {
              runName: "VSTest",
              title: "PaymentFlowTests.RefundsAreIdempotent",
              errorMessage: "Expected 1 refund, got 2.",
              durationMs: 412,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("PaymentFlowTests.RefundsAreIdempotent")).toBeTruthy();
    expect(screen.getByText("Expected 1 refund, got 2.")).toBeTruthy();
  });

  it("notes truncation when more failed tests exist than shown", () => {
    render(
      <PipelineTestSummary
        summary={summary({
          failed: [
            { runName: "VSTest", title: "Test1", errorMessage: null, durationMs: 1 },
          ],
          truncated: true,
        })}
      />,
    );
    expect(screen.getByText(/More failed tests exist/)).toBeTruthy();
  });
});
