import { describe, expect, it } from "vitest";
import { demoPipelineRuns, demoPipelineRunsFiltered } from "./pipelines";

describe("demo pipeline runs", () => {
  it("returns only the requested definition's runs, like the real backend", () => {
    const ci = demoPipelineRunsFiltered({ definitionId: 1 });
    const nightly = demoPipelineRunsFiltered({ definitionId: 2 });

    expect(ci.length).toBeGreaterThan(0);
    expect(nightly.length).toBeGreaterThan(0);
    expect(ci.every((run) => run.definitionId === 1)).toBe(true);
    expect(nightly.every((run) => run.definitionId === 2)).toBe(true);
    expect(ci.length + nightly.length).toBe(demoPipelineRuns().length);
  });

  it("returns every run when no definition is given", () => {
    expect(demoPipelineRunsFiltered()).toEqual(demoPipelineRuns());
  });
});
