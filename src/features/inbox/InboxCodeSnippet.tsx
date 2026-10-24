import { useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  getPullRequestFileDiff,
  listPullRequestChanges,
  prLocator,
  type PrThread,
} from "@/lib/azdoCommands";
import type { InboxEntry } from "./inboxPresentation";

/** Lines shown above and below the commented line. */
export const SNIPPET_CONTEXT_LINES = 5;

/** The lines around `line` (1-based), clamped to the file. */
export function snippetLines(
  content: string,
  line: number,
  context = SNIPPET_CONTEXT_LINES,
): { number: number; text: string }[] {
  const lines = content.split(/\r?\n/);
  const first = Math.max(1, line - context);
  const last = Math.min(lines.length, line + context);
  const out: { number: number; text: string }[] = [];
  for (let number = first; number <= last; number += 1) {
    out.push({ number, text: lines[number - 1] ?? "" });
  }
  return out;
}

const UNAVAILABLE: Record<string, string> = {
  binary: "This is a binary file.",
  tooLarge: "The file is too large to show here.",
  missing: "The file is not in this version of the pull request.",
};

function unavailableMessage(reason: string | null): string {
  return (reason && UNAVAILABLE[reason]) || "The code is not available.";
}

/**
 * The code a line comment points at, with the commented line marked. The file
 * comes from the PR's latest iteration (the new side; the old side for a
 * comment on a deleted line). Failures stay inside this box and never block
 * the reply or Done.
 */
export function InboxCodeSnippet({ item, thread }: { item: InboxEntry; thread: PrThread }) {
  const filePath = thread.filePath;
  const onNewSide = thread.rightLine != null;
  const line = thread.rightLine ?? thread.leftLine;
  const locator = prLocator({
    organizationId: item.organizationId,
    projectId: item.projectId,
    repositoryId: item.repositoryId,
    pullRequestId: item.subjectId,
  });
  const changesQuery = useQuery({
    // Shared with My Reviews' changed-files cache.
    queryKey: ["pullRequestChanges", item.organizationId, item.repositoryId, item.subjectId],
    queryFn: () => listPullRequestChanges(locator),
    enabled: !!filePath && line != null,
    staleTime: 5 * 60_000,
  });
  const changes = changesQuery.data;
  const file = changes?.files.find((candidate) => candidate.path === filePath);
  const diffQuery = useQuery({
    queryKey: [
      "inboxFileDiff",
      item.organizationId,
      item.repositoryId,
      item.subjectId,
      filePath,
      changes?.baseCommitId,
      changes?.targetCommitId,
    ],
    queryFn: () =>
      getPullRequestFileDiff({
        ...locator,
        filePath: filePath ?? "",
        originalPath: file?.originalPath ?? null,
        // A thread can sit on a file the latest iteration did not touch.
        changeType: file?.changeType ?? "edit",
        baseCommitId: changes?.baseCommitId,
        targetCommitId: changes?.targetCommitId,
      }),
    enabled: !!changes && !!filePath && line != null,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!filePath || line == null) return null;

  const header = (
    <div className="flex min-w-0 items-center gap-1 border-b border-border px-2 py-0.5 font-mono text-2xs text-muted-foreground">
      <span className="min-w-0 truncate" title={filePath}>
        {filePath}
      </span>
      <span className="shrink-0">:{line}</span>
      {!onNewSide ? <span className="shrink-0">(removed line)</span> : null}
    </div>
  );

  let body;
  const error = changesQuery.error ?? diffQuery.error;
  if (error) {
    body = <p className="px-2 py-1 text-2xs text-muted-foreground">Could not load the code: {commandErrorMessage(error)}</p>;
  } else if (!diffQuery.data) {
    body = <p className="px-2 py-1 text-2xs text-muted-foreground">Loading the code…</p>;
  } else {
    const diff = diffQuery.data;
    const content = onNewSide ? diff.targetContent : diff.baseContent;
    const reason = onNewSide ? diff.targetUnavailableReason : diff.baseUnavailableReason;
    body = content == null ? (
      <p className="px-2 py-1 text-2xs text-muted-foreground">{unavailableMessage(reason)}</p>
    ) : (
      <div className="overflow-x-auto py-0.5">
        <table className="w-full border-collapse font-mono text-2xs leading-4" aria-label={`Code around line ${line}`}>
          <tbody>
            {snippetLines(content, line).map((row) => (
              <tr
                key={row.number}
                data-commented-line={row.number === line ? "true" : undefined}
                className={row.number === line ? "bg-warning/10" : undefined}
              >
                <td className="w-10 select-none pr-2 text-right align-top text-muted-foreground tabular-nums">{row.number}</td>
                <td className="whitespace-pre pr-2">{row.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div data-inbox-code="true" className="rounded border border-border bg-muted/40">
      {header}
      {body}
    </div>
  );
}
