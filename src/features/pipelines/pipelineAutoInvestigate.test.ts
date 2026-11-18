import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRunSummary } from "@/lib/azdoCommands";

const submitPipelineInvestigation = vi.fn();
const listPipelineTestResults = vi.fn();
const listFlakyTests = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  submitPipelineInvestigation: (...args: unknown[]) => submitPipelineInvestigation(...args),
  listPipelineTestResults: (...args: unknown[]) => listPipelineTestResults(...args),
  listFlakyTests: (...args: unknown[]) => listFlakyTests(...args),
}));
vi.mock("@/components/agent/contextDocument", () => ({
  buildContextDocument: async () => "# Pipeline run material",
}));

import {
  failedTestsSection,
  isInvestigableFailure,
  startPipelineInvestigation,
} from "./pipelineAutoInvestigate";

const run: PipelineRunSummary = {
  organizationId: "org",
  projectId: "p1",
  projectName: "Project",
  buildId: 42,
  buildNumber: "20261031.2",
  definitionId: 7,
  definitionName: "CI",
  status: "completed",
  result: "failed",
  sourceBranch: "refs/heads/main",
  reason: "individualCI",
  requestedFor: "Someone",
  queueTime: null,
  startTime: null,
  finishTime: null,
  webUrl: "https://dev.azure.com/org/Project/_build/results?buildId=42",
};

beforeEach(() => {
  for (const mock of [submitPipelineInvestigation, listPipelineTestResults, listFlakyTests]) mock.mockReset();
});

describe("isInvestigableFailure", () => {
  it("only takes runs that finished as failed", () => {
    expect(isInvestigableFailure("finished", { result: "failed" })).toBe(true);
    expect(isInvestigableFailure("finished", { result: "canceled" })).toBe(false);
    expect(isInvestigableFailure("finished", { result: "partiallySucceeded" })).toBe(false);
    expect(isInvestigableFailure("started", { result: "failed" })).toBe(false);
    expect(isInvestigableFailure(null, { result: "failed" })).toBe(false);
  });
});

describe("failedTestsSection", () => {
  it("lists each failed test with its history from recent runs", async () => {
    listPipelineTestResults.mockResolvedValue({
      total: 10,
      passed: 8,
      failed: 2,
      other: 0,
      failedTests: [
        { name: "A", runName: "Unit", errorMessage: "boom\nstack", durationMs: 1 },
        { name: "B", runName: "Unit", errorMessage: null, durationMs: null },
      ],
      truncated: false,
    });
    listFlakyTests.mockResolvedValue({
      comparedRuns: 10,
      skippedRuns: 0,
      tests: [
        { name: "A", kind: "flaky", failedRuns: 3, observedRuns: 10, sinceBuildId: null, sinceBuildNumber: null },
      ],
    });

    const section = await failedTestsSection(run);

    expect(listFlakyTests).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "p1",
      definitionId: 7,
      branch: "refs/heads/main",
    });
    expect(section).toContain("Compared with the last 10 completed runs");
    expect(section).toContain("- A — Flaky 3/10:");
    expect(section).toContain("  - Error: boom");
    expect(section).not.toContain("stack");
    expect(section).toContain("- B — no history");
    expect(section).toContain("1 of 2 listed failures are known flaky tests.");
  });

  it("is empty without failed tests and notes a missing comparison", async () => {
    listPipelineTestResults.mockResolvedValue({
      total: 3, passed: 3, failed: 0, other: 0, failedTests: [], truncated: false,
    });
    expect(await failedTestsSection(run)).toBe("");

    listPipelineTestResults.mockResolvedValue({
      total: 3, passed: 2, failed: 1, other: 0,
      failedTests: [{ name: "A", runName: null, errorMessage: null, durationMs: null }],
      truncated: false,
    });
    listFlakyTests.mockRejectedValue(new Error("403"));
    expect(await failedTestsSection(run)).toContain("comparison with recent runs is unavailable");
  });
});

describe("startPipelineInvestigation", () => {
  it("submits the scoped build and its material to the tracked runner", async () => {
    listPipelineTestResults.mockResolvedValue({
      total: 0, passed: 0, failed: 0, other: 0, failedTests: [], truncated: false,
    });
    submitPipelineInvestigation.mockResolvedValue(true);

    await expect(startPipelineInvestigation(run)).resolves.toBe(true);
    expect(submitPipelineInvestigation).toHaveBeenCalledWith({
      organizationId: run.organizationId,
      projectId: run.projectId,
      buildId: run.buildId,
      title: "CI · 20261031.2",
      projectName: run.projectName,
      webUrl: run.webUrl,
      body: expect.stringContaining("Verdict: flaky | code | infra | unknown"),
      context: expect.stringContaining(run.webUrl),
      contextDocument: "# Pipeline run material",
    });
  });
});
