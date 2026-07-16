import { describe, expect, it } from "vitest";
import { dispatchExt } from "./dispatchExt";
import { demoPipelineRuns } from "./pipelines";
import { demoSearchCode } from "./commits";

describe("pipeline demo data", () => {
  it("filters runs by pipeline definition", () => {
    const definitionOne = dispatchExt("list_pipeline_runs", {
      input: { definitionId: 1 },
    }) as ReturnType<typeof demoPipelineRuns>;
    const definitionTwo = dispatchExt("list_pipeline_runs", {
      input: { definitionId: 2 },
    }) as ReturnType<typeof demoPipelineRuns>;

    expect(definitionOne.map((run) => run.buildId)).toEqual([1001, 1002]);
    expect(definitionTwo.map((run) => run.buildId)).toEqual([1003]);
  });

  it("uses the configured demo organization in external URLs", () => {
    expect(demoPipelineRuns().every((run) => run.webUrl.startsWith("https://dev.azure.com/contoso/"))).toBe(true);
    expect(
      demoSearchCode("search").results.every((result) =>
        result.webUrl.startsWith("https://dev.azure.com/contoso/"),
      ),
    ).toBe(true);
  });
});
