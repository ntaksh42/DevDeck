import { useQuery } from "@tanstack/react-query";
import { listPipelineTestResults } from "@/lib/azdoCommands";
import { PreviewBand } from "@/components/PreviewBand";

// The run's test summary and failed tests. Hidden while loading, on failure
// (the run view stays useful without it), and when the build published no tests.
// Each failed test is a native <details> so Enter/Space expands its error.
export function PipelineTestResultsPanel({
  organizationId,
  projectId,
  buildId,
}: {
  organizationId: string | undefined;
  projectId: string;
  buildId: number | null;
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
  if (!results || results.total === 0) return null;

  return (
    <div className="border-b border-border pb-2">
      <PreviewBand>Tests ({results.total})</PreviewBand>
      <p className="flex flex-wrap gap-x-3 px-3 text-xs">
        <span className="text-emerald-600 dark:text-emerald-400">{results.passed} passed</span>
        <span className={results.failed > 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
          {results.failed} failed
        </span>
        {results.other > 0 ? (
          <span className="text-muted-foreground">{results.other} skipped / other</span>
        ) : null}
      </p>
      {results.failedTests.length > 0 ? (
        <ul className="mt-1 flex flex-col px-3">
          {results.failedTests.map((test, index) => (
            <li key={`${test.runName ?? ""}:${test.name}:${index}`}>
              <details className="group">
                <summary className="flex cursor-pointer items-baseline gap-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={test.name}>
                    {test.name}
                  </span>
                  {test.durationMs != null ? (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {test.durationMs} ms
                    </span>
                  ) : null}
                </summary>
                <pre className="mb-1 ml-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                  {test.errorMessage ?? "No error message."}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
      {results.truncated ? (
        <p className="px-3 pt-1 text-[11px] text-muted-foreground">
          Showing the first {results.failedTests.length} of {results.failed} failed tests.
        </p>
      ) : null}
    </div>
  );
}
