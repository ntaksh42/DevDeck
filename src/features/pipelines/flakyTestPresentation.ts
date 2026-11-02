import type { FlakyTestKind, FlakyTestReport, FlakyTestStat } from "@/lib/azdoCommands";

export type FlakyBadge = {
  label: string;
  /** One sentence on what the comparison found, shown when the test is expanded. */
  explanation: string;
  tone: "warning" | "destructive" | "muted";
};

// Kinds that point at the test rather than the change: a retry is likely enough.
const FLAKY_KINDS: ReadonlySet<FlakyTestKind> = new Set(["flaky", "unstable"]);

export function flakyBadge(stat: FlakyTestStat): FlakyBadge {
  const ratio = `${stat.failedRuns}/${stat.observedRuns}`;
  switch (stat.kind) {
    case "flaky":
      return {
        label: `Flaky ${ratio}`,
        explanation: `Failed and passed on the same commit; failed in ${ratio} recent runs.`,
        tone: "warning",
      };
    case "unstable":
      return {
        label: `Unstable ${ratio}`,
        explanation: `Switched between passing and failing more than once; failed in ${ratio} recent runs.`,
        tone: "warning",
      };
    case "newFailure":
      return {
        label: stat.sinceBuildNumber ? `New since ${stat.sinceBuildNumber}` : "New failure",
        explanation: `Passed before and has failed in every run since ${
          stat.sinceBuildNumber ?? "a recent run"
        }; likely caused by a change.`,
        tone: "destructive",
      };
    case "consistent":
      return {
        label: `Failing ${ratio}`,
        explanation: `Failed in every recent run it ran in (${ratio}).`,
        tone: "destructive",
      };
    case "fixed":
      return {
        label: "Fixed later",
        explanation: `Passes in the latest runs; failed in ${ratio} recent runs.`,
        tone: "muted",
      };
  }
}

export function flakyStatsByName(report: FlakyTestReport | undefined): Map<string, FlakyTestStat> {
  return new Map((report?.tests ?? []).map((stat) => [stat.name, stat]));
}

// A one-line hint about the run's failures, or null when the comparison says
// nothing useful (no listed failure is flaky).
export function flakyHint(
  failedNames: readonly string[],
  stats: Map<string, FlakyTestStat>,
  truncated: boolean,
): string | null {
  if (failedNames.length === 0) return null;
  const flaky = failedNames.filter((name) => {
    const stat = stats.get(name);
    return stat != null && FLAKY_KINDS.has(stat.kind);
  }).length;
  if (flaky === 0) return null;
  if (flaky === failedNames.length && !truncated) {
    return "All failures are known flaky tests — retrying the failed jobs is likely enough.";
  }
  return `${flaky} of ${failedNames.length} listed failures are known flaky tests.`;
}
