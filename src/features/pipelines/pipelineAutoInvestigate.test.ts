import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineRunSummary } from "@/lib/azdoCommands";

const createAgentNote = vi.fn();
const runAgent = vi.fn();
const listPipelineTestResults = vi.fn();
const listFlakyTests = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  createAgentNote: (...args: unknown[]) => createAgentNote(...args),
  runAgent: (...args: unknown[]) => runAgent(...args),
  listPipelineTestResults: (...args: unknown[]) => listPipelineTestResults(...args),
  listFlakyTests: (...args: unknown[]) => listFlakyTests(...args),
}));
vi.mock("@/components/agent/contextDocument", () => ({
  buildContextDocument: async () => "# Pipeline run material",
}));

import {
  AUTO_INVESTIGATIONS_PER_HOUR,
  claimInvestigation,
  enqueuePipelineInvestigation,
  failedTestsSection,
  investigationKey,
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
  localStorage.clear();
  for (const mock of [createAgentNote, runAgent, listPipelineTestResults, listFlakyTests]) mock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("isInvestigableFailure", () => {
  it("only takes runs that finished as failed", () => {
    expect(isInvestigableFailure("finished", { result: "failed" })).toBe(true);
    expect(isInvestigableFailure("finished", { result: "canceled" })).toBe(false);
    expect(isInvestigableFailure("finished", { result: "partiallySucceeded" })).toBe(false);
    expect(isInvestigableFailure("started", { result: "failed" })).toBe(false);
    expect(isInvestigableFailure(null, { result: "failed" })).toBe(false);
  });
});

describe("claimInvestigation", () => {
  it("claims each run once", () => {
    expect(claimInvestigation(investigationKey(run), 1_000)).toBe(true);
    expect(claimInvestigation(investigationKey(run), 2_000)).toBe(false);
  });

  it("stops at the hourly limit and frees up an hour later", () => {
    for (let i = 0; i < AUTO_INVESTIGATIONS_PER_HOUR; i += 1) {
      expect(claimInvestigation(`run-${i}`, 1_000 + i)).toBe(true);
    }
    expect(claimInvestigation("one-too-many", 2_000)).toBe(false);
    expect(claimInvestigation("one-too-many", 1_000 + 60 * 60 * 1000 + 10)).toBe(true);
  });

  it("survives unreadable storage", () => {
    localStorage.setItem("azdodeck:pipelines:autoInvestigated", "{not json");
    expect(claimInvestigation("a", 1)).toBe(true);
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
  it("creates an investigate request about the run and starts the agent", async () => {
    listPipelineTestResults.mockResolvedValue({
      total: 0, passed: 0, failed: 0, other: 0, failedTests: [], truncated: false,
    });
    createAgentNote.mockResolvedValue({});
    runAgent.mockResolvedValue(undefined);

    await startPipelineInvestigation(run);

    const note = createAgentNote.mock.calls[0][0];
    expect(note.target).toBe("ask");
    expect(note.kind).toBe("investigate");
    expect(note.body).toMatch(/Verdict: flaky \| code \| infra \| unknown/);
    expect(note.context).toContain(run.webUrl);
    expect(note.contextDocument).toBe("# Pipeline run material");
    expect(runAgent).toHaveBeenCalledWith({ target: "ask", itemId: note.itemId });
  });
});

describe("enqueuePipelineInvestigation", () => {
  it("starts queued runs one after another and reports each start", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const start = vi.fn(async (r: PipelineRunSummary) => {
      order.push(`start ${r.buildId}`);
    });
    const first = enqueuePipelineInvestigation(run, () => order.push("started 42"), start);
    const second = enqueuePipelineInvestigation({ ...run, buildId: 43 }, () => order.push("started 43"), start);
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(order).toEqual(["start 42", "started 42", "start 43", "started 43"]);
  });

  it("keeps the queue going after a failure", async () => {
    vi.useFakeTimers();
    const onStarted = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = enqueuePipelineInvestigation(run, onStarted, async () => {
      throw new Error("no agent");
    });
    const next = enqueuePipelineInvestigation(run, onStarted, async () => {});
    await vi.runAllTimersAsync();
    await Promise.all([failing, next]);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
