import type { PipelineTestSummary as PipelineTestSummaryData } from "@/lib/azdoCommands";

export function PipelineTestSummary({ summary }: { summary: PipelineTestSummaryData }) {
  if (summary.totalTests === 0 && summary.failed.length === 0) return null;

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium">Tests</span>
        <span className="text-emerald-700 dark:text-emerald-400">{summary.passedTests} passed</span>
        <span
          className={
            summary.failedTests > 0
              ? "text-red-700 dark:text-red-400"
              : "text-muted-foreground"
          }
        >
          {summary.failedTests} failed
        </span>
        <span className="text-muted-foreground">{summary.totalTests} total</span>
      </div>
      {summary.failed.length > 0 ? (
        <ul className="mt-1.5 grid gap-1">
          {summary.failed.map((test, index) => (
            <li
              key={`${test.title}:${index}`}
              className="rounded border border-red-200 bg-red-50 px-2 py-1 dark:border-red-900/50 dark:bg-red-950/30"
            >
              <p className="truncate text-xs font-medium" title={test.title}>
                {test.title}
              </p>
              {test.errorMessage ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                  {test.errorMessage}
                </p>
              ) : null}
            </li>
          ))}
          {summary.truncated ? (
            <li className="text-[11px] text-muted-foreground">
              More failed tests exist; showing the first {summary.failed.length}.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
