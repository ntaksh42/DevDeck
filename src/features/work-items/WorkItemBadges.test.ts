import { describe, expect, it } from "vitest";
import { workItemPriorityDotClass } from "./WorkItemBadges";

describe("workItemPriorityDotClass", () => {
  it("maps priorities 1-4 to distinct colors", () => {
    expect(workItemPriorityDotClass("1")).toBe("bg-red-500");
    expect(workItemPriorityDotClass("2")).toBe("bg-orange-500");
    expect(workItemPriorityDotClass("3")).toBe("bg-yellow-500");
    expect(workItemPriorityDotClass("4")).toBe("bg-slate-400");
  });

  it("falls back to neutral for unknown values", () => {
    expect(workItemPriorityDotClass("")).toBe("bg-slate-400");
    expect(workItemPriorityDotClass("9")).toBe("bg-slate-400");
  });
});
