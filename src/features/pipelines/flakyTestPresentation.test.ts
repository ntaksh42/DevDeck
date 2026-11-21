import { describe, expect, it } from "vitest";
import type { FlakyTestStat } from "@/lib/azdoCommands";
import { flakyBadge, flakyHint, flakyStatsByName } from "./flakyTestPresentation";

function stat(name: string, kind: FlakyTestStat["kind"], extra: Partial<FlakyTestStat> = {}): FlakyTestStat {
  return {
    name,
    kind,
    failedRuns: 3,
    observedRuns: 10,
    sinceBuildId: null,
    sinceBuildNumber: null,
    ...extra,
  };
}

describe("flakyBadge", () => {
  it("labels each kind with its failure ratio or starting run", () => {
    expect(flakyBadge(stat("a", "flaky")).label).toBe("Flaky 3/10");
    expect(flakyBadge(stat("a", "unstable")).label).toBe("Unstable 3/10");
    expect(flakyBadge(stat("a", "consistent")).label).toBe("Failing 3/10");
    expect(flakyBadge(stat("a", "fixed")).label).toBe("Fixed later");
    expect(
      flakyBadge(stat("a", "newFailure", { sinceBuildId: 9, sinceBuildNumber: "20260612.3" })).label,
    ).toBe("New since 20260612.3");
    expect(flakyBadge(stat("a", "newFailure")).label).toBe("New failure");
  });
});

describe("flakyHint", () => {
  const stats = flakyStatsByName({
    comparedRuns: 10,
    skippedRuns: 0,
    tests: [stat("a", "flaky"), stat("b", "unstable"), stat("c", "newFailure")],
  });

  it("recommends a retry when every listed failure is flaky", () => {
    expect(flakyHint(["a", "b"], stats, false)).toMatch(/retrying the failed jobs/);
  });

  it("counts the flaky failures when only some are", () => {
    expect(flakyHint(["a", "c"], stats, false)).toBe("1 of 2 listed failures are known flaky tests.");
  });

  it("does not recommend a retry when more failures exist than are listed", () => {
    expect(flakyHint(["a", "b"], stats, true)).toBe("2 of 2 listed failures are known flaky tests.");
  });

  it("says nothing when no failure is flaky or unknown", () => {
    expect(flakyHint(["c", "zzz"], stats, false)).toBeNull();
    expect(flakyHint([], stats, false)).toBeNull();
  });
});
