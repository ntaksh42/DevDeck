import { describe, expect, it } from "vitest";
import { demoInvoke } from "./azdoDemo";
import type { PipelineRunSummary } from "./azdoCommands";

describe("demoInvoke list_pipeline_runs", () => {
  it("returns only the runs for the requested definition", async () => {
    const ci = (await demoInvoke("list_pipeline_runs", {
      input: { projectId: "demo-project", definitionId: 1 },
    })) as PipelineRunSummary[];
    expect(ci.length).toBeGreaterThan(0);
    expect(ci.every((r) => r.definitionId === 1)).toBe(true);

    const nightly = (await demoInvoke("list_pipeline_runs", {
      input: { projectId: "demo-project", definitionId: 2 },
    })) as PipelineRunSummary[];
    expect(nightly.length).toBeGreaterThan(0);
    expect(nightly.every((r) => r.definitionId === 2)).toBe(true);

    // Each subscription must see a distinct run history, not a shared list.
    const ciIds = new Set(ci.map((r) => r.buildId));
    expect(nightly.some((r) => ciIds.has(r.buildId))).toBe(false);
  });

  it("returns every run when no definitionId is supplied", async () => {
    const all = (await demoInvoke("list_pipeline_runs", {
      input: { projectId: "demo-project" },
    })) as PipelineRunSummary[];
    expect(all.length).toBeGreaterThan(1);
    expect(new Set(all.map((r) => r.definitionId)).size).toBeGreaterThan(1);
  });
});
