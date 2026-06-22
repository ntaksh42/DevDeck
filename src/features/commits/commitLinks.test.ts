import { describe, expect, it } from "vitest";
import { hasWorkItemReference } from "./commitLinks";

describe("hasWorkItemReference", () => {
  it("detects an AB# work item reference", () => {
    expect(hasWorkItemReference("Fix login bug AB#1234")).toBe(true);
    expect(hasWorkItemReference("AB#7 initial commit")).toBe(true);
    // Case-insensitive.
    expect(hasWorkItemReference("ab#42 tweak")).toBe(true);
  });

  it("returns false when there is no AB# reference", () => {
    expect(hasWorkItemReference("Refactor the sync loop")).toBe(false);
    // A bare #123 is not the Azure Boards cross-service syntax.
    expect(hasWorkItemReference("Closes #123")).toBe(false);
    // "AB#" without digits does not count.
    expect(hasWorkItemReference("Mention AB#x somewhere")).toBe(false);
    expect(hasWorkItemReference("")).toBe(false);
  });
});
