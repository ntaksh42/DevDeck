import { describe, expect, it } from "vitest";
import { pipelineRunVisual, isInProgressStatus } from "./pipelineStatus";

describe("pipelineRunVisual", () => {
  it("labels a failed completed run", () => {
    const v = pipelineRunVisual("completed", "failed");
    expect(v.label).toBe("Failed");
    expect(v.tone).toBe("error");
  });

  it("labels an in-progress run regardless of result", () => {
    const v = pipelineRunVisual("inProgress", null);
    expect(v.label).toBe("Running");
    expect(v.tone).toBe("active");
  });

  it("detects in-progress statuses", () => {
    expect(isInProgressStatus("inProgress")).toBe(true);
    expect(isInProgressStatus("notStarted")).toBe(true);
    expect(isInProgressStatus("completed")).toBe(false);
    expect(isInProgressStatus(null)).toBe(false);
  });
});
