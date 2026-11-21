import { useQuery } from "@tanstack/react-query";
import { listFlakyTests, listPipelineTestResults } from "@/lib/azdoCommands";
import { PreviewBand } from "@/components/PreviewBand";
import { type FlakyBadge, flakyBadge, flakyHint, flakyStatsByName } from "./flakyTestPresentation";

const BADGE_TONE: Record<FlakyBadge["tone"], string> = {
  warning: "border-warning/30 bg-warning/10 text-warning",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

// The run's test summary and failed tests. Hidden while loading, on failure
// (the run view stays useful without it), and when the build published no tests.
// Each failed test is a native <details> so Enter/Space expands its error.
// When tests failed, the definition's recent runs on the same branch are
// compared (`list_flaky_tests`) to badge each failure as flaky / new / ...;
// that comparison is optional and silently left out when it fails.
export function PipelineTestResultsPanel({
  organizationId,
  projectId,
  buildId,
  definitionId,
  sourceBranch,
}: {
  organizationId: string | undefined;
  projectId: string;
  buildId: number | null;
  definitionId?: number | null;
  sourceBranch?: string | null;
}) {
  const query = useQuery({
    queryKey: ["pipelineTestResults", organizationId, projectId, buildId],
    queryFn: () =>
      listPipelineTestResults({ organizationId, projectId, buildId: buildId as number }),
    enabled: buildId != null && !!projectId,
    staleTime: 60_000,
    retry: false,
  });
  const results = query.data;
  const hasFailures = (results?.failedTests.length ?? 0) > 0;
  const flakyQuery = useQuery({
    queryKey: ["pipelineFlakyTests", organizationId, projectId, definitionId, sourceBranch ?? null],
    queryFn: () =>
      listFlakyTests({
        organizationId,
        projectId,
        definitionId: definitionId as number,
        branch: sourceBranch ?? undefined,
      }),
    enabled: hasFailures && definitionId != null && !!projectId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!results || results.total === 0) return null;

  const stats = flakyStatsByName(flakyQuery.data);
  const hint = flakyHint(
    results.failedTests.map((test) => test.name),
    stats,
    results.truncated,
  );

  return (
    <div className="border-b border-border pb-2">
      <PreviewBand>Tests ({results.total})</PreviewBand>
      <p className="flex flex-wrap gap-x-3 px-3 text-xs">
        <span className="text-success">{results.passed} passed</span>
        <span className={results.failed > 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
          {results.failed} failed
        </span>
        {results.other > 0 ? (
          <span className="text-muted-foreground">{results.other} skipped / other</span>
        ) : null}
      </p>
      {hint ? (
        <p className="mx-3 mt-1 rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">
          {hint}
        </p>
      ) : null}
      {results.failedTests.length > 0 ? (
        <ul className="mt-1 flex flex-col px-3">
          {results.failedTests.map((test, index) => {
            const stat = stats.get(test.name);
            const badge = stat ? flakyBadge(stat) : null;
            return (
              <li key={`${test.runName ?? ""}:${test.name}:${index}`}>
                <details className="group">
                  <summary className="flex cursor-pointer items-baseline gap-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={test.name}>
                      {test.name}
                    </span>
                    {badge ? (
                      <span
                        className={`shrink-0 rounded border px-1 text-2xs ${BADGE_TONE[badge.tone]}`}
                        title={badge.explanation}
                      >
                        {badge.label}
                      </span>
                    ) : null}
                    {test.durationMs != null ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {test.durationMs} ms
                      </span>
                    ) : null}
                  </summary>
                  {badge ? (
                    <p className="ml-3 text-2xs text-muted-foreground">{badge.explanation}</p>
                  ) : null}
                  <pre className="mb-1 ml-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 text-2xs text-foreground">
                    {test.errorMessage ?? "No error message."}
                  </pre>
                </details>
              </li>
            );
          })}
        </ul>
      ) : null}
      {results.truncated ? (
        <p className="px-3 pt-1 text-2xs text-muted-foreground">
          Showing the first {results.failedTests.length} of {results.failed} failed tests.
        </p>
      ) : null}
      {flakyQuery.data && flakyQuery.data.comparedRuns > 0 ? (
        <p className="px-3 pt-1 text-2xs text-muted-foreground">
          Compared with the last {flakyQuery.data.comparedRuns} completed runs on this branch
          {flakyQuery.data.skippedRuns > 0
            ? ` (${flakyQuery.data.skippedRuns} could not be read)`
            : ""}
          .
        </p>
      ) : null}
    </div>
  );
}
