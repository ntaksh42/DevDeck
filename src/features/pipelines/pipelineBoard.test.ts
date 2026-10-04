import { describe, expect, it } from "vitest";
import { filterBoardRows, historyCells, sortBoardRows } from "./pipelineBoard";
import { pipelineRunVisual } from "./pipelineStatus";

function row(name: string, status: string, result: string | null, queueTime: string | null) {
  return {
    sub: { definitionName: name },
    latest: { queueTime },
    visual: pipelineRunVisual(status, result),
  };
}

const rows = [
  row("b-ok", "completed", "succeeded", "2026-06-13T09:00:00Z"),
  row("a-failed", "completed", "failed", "2026-06-13T10:00:00Z"),
  row("c-running", "inProgress", null, "2026-06-13T08:00:00Z"),
  row("d-ok", "completed", "succeeded", "2026-06-13T11:00:00Z"),
];

describe("pipelineBoard", () => {
  it("orders running, then failed, then the rest in watch order", () => {
    expect(sortBoardRows(rows, "status").map((r) => r.sub.definitionName)).toEqual([
      "c-running",
      "a-failed",
      "b-ok",
      "d-ok",
    ]);
  });

  it("sorts by name and by most recent run", () => {
    expect(sortBoardRows(rows, "name").map((r) => r.sub.definitionName)).toEqual([
      "a-failed",
      "b-ok",
      "c-running",
      "d-ok",
    ]);
    expect(sortBoardRows(rows, "lastRun").map((r) => r.sub.definitionName)).toEqual([
      "d-ok",
      "a-failed",
      "b-ok",
      "c-running",
    ]);
  });

  it("filters by the latest run's state", () => {
    expect(filterBoardRows(rows, "failed").map((r) => r.sub.definitionName)).toEqual(["a-failed"]);
    expect(filterBoardRows(rows, "running").map((r) => r.sub.definitionName)).toEqual(["c-running"]);
    expect(filterBoardRows(rows, null)).toHaveLength(4);
  });

  it("builds history cells oldest first, capped to the limit", () => {
    const runs = [
      { buildId: 3, buildNumber: "3", status: "completed", result: "failed", queueTime: null },
      { buildId: 2, buildNumber: "2", status: "completed", result: "succeeded", queueTime: null },
      { buildId: 1, buildNumber: "1", status: "completed", result: "succeeded", queueTime: null },
    ];
    expect(historyCells(runs, 2).map((c) => c.buildId)).toEqual([2, 3]);
    expect(historyCells(runs)[2].tone).toBe("error");
  });
});
