import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  getPullRequestFileDiff,
  listPullRequestChanges,
  type PrChangedFile,
  type PrThread,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import { buildDiffLines, type DiffLine } from "@/lib/diffView";
import { openExternalUrl } from "@/lib/openExternal";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";

const MAX_RENDERED_DIFF_LINES = 2000;

const CHANGE_TYPE_BADGES: { match: string; label: string; cls: string }[] = [
  { match: "add", label: "A", cls: "border-green-200 bg-green-100 text-green-800" },
  { match: "delete", label: "D", cls: "border-red-200 bg-red-100 text-red-800" },
  { match: "rename", label: "R", cls: "border-purple-200 bg-purple-100 text-purple-800" },
  { match: "edit", label: "M", cls: "border-blue-200 bg-blue-100 text-blue-800" },
];

function changeTypeBadge(changeType: string) {
  const normalized = changeType.toLowerCase();
  return (
    CHANGE_TYPE_BADGES.find((badge) => normalized.includes(badge.match)) ??
    CHANGE_TYPE_BADGES[CHANGE_TYPE_BADGES.length - 1]
  );
}

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  binary: "Binary file — diff is not available.",
  tooLarge: "File is too large to diff in the app.",
  missing: "File content could not be loaded.",
};

export function PrFilesTab({
  pr,
  threads,
}: {
  pr: ReviewPullRequestSummary;
  threads: PrThread[] | undefined;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const changesQuery = useQuery({
    queryKey: ["prChanges", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () =>
      listPullRequestChanges({
        organizationId: pr.organizationId,
        projectId: pr.projectId,
        repositoryId: pr.repositoryId,
        pullRequestId: pr.pullRequestId,
      }),
    staleTime: 60_000,
  });

  const changes = changesQuery.data ?? null;
  const files = changes?.files ?? [];
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;

  // Reset file selection when switching PRs.
  useEffect(() => {
    setSelectedPath(null);
  }, [pr.pullRequestId, pr.repositoryId]);

  const activeThreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads ?? []) {
      if (!thread.filePath) continue;
      if (thread.status !== "active" && thread.status !== "pending") continue;
      counts.set(thread.filePath, (counts.get(thread.filePath) ?? 0) + 1);
    }
    return counts;
  }, [threads]);

  const diffQuery = useQuery({
    queryKey: [
      "prFileDiff",
      pr.organizationId,
      pr.repositoryId,
      pr.pullRequestId,
      selectedFile?.path,
    ],
    queryFn: () =>
      getPullRequestFileDiff({
        organizationId: pr.organizationId,
        projectId: pr.projectId,
        repositoryId: pr.repositoryId,
        pullRequestId: pr.pullRequestId,
        filePath: (selectedFile as PrChangedFile).path,
        originalPath: selectedFile?.originalPath ?? null,
        changeType: selectedFile?.changeType ?? "edit",
        baseCommitId: changes?.baseCommitId ?? null,
        targetCommitId: changes?.targetCommitId ?? null,
      }),
    enabled: !!selectedFile && !!changes,
    staleTime: 60_000,
  });

  if (changesQuery.isLoading) return <LoadingState />;
  if (changesQuery.isError) return <ErrorState message={commandErrorMessage(changesQuery.error)} />;
  if (files.length === 0) return <PreviewEmptyState message="No changed files." />;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col outline-none"
      data-primary-preview="true"
      tabIndex={-1}
    >
      {/* File list */}
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border">
        {files.map((file) => {
          const badge = changeTypeBadge(file.changeType);
          const threadCount = activeThreadCounts.get(file.path) ?? 0;
          const selected = file.path === selectedPath;
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => setSelectedPath(file.path)}
              className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs ${
                selected ? "bg-secondary" : "hover:bg-muted/50"
              }`}
              title={file.path}
            >
              <span
                className={`inline-flex w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
                aria-label={file.changeType}
              >
                {badge.label}
              </span>
              {/* dir=rtl keeps the filename visible when truncating; the LRM
                  mark stops the leading slash from jumping to the end. */}
              <span className="min-w-0 flex-1 truncate font-mono" dir="rtl">
                {`‎${file.path}`}
              </span>
              {threadCount > 0 ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 text-[10px] font-medium text-blue-700">
                  {threadCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Diff */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!selectedFile ? (
          <PreviewEmptyState message="Select a file to view its diff." />
        ) : diffQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading diff
          </div>
        ) : diffQuery.isError ? (
          <ErrorState message={commandErrorMessage(diffQuery.error)} />
        ) : diffQuery.data ? (
          <DiffContent
            baseContent={diffQuery.data.baseContent}
            targetContent={diffQuery.data.targetContent}
            unavailableReason={
              diffQuery.data.targetUnavailableReason ?? diffQuery.data.baseUnavailableReason
            }
            webUrl={pr.webUrl}
          />
        ) : null}
      </div>
    </div>
  );
}

function DiffContent({
  baseContent,
  targetContent,
  unavailableReason,
  webUrl,
}: {
  baseContent: string | null;
  targetContent: string | null;
  unavailableReason: string | null;
  webUrl: string | null;
}) {
  const lines = useMemo(
    () =>
      unavailableReason ? [] : buildDiffLines(baseContent ?? "", targetContent ?? ""),
    [baseContent, targetContent, unavailableReason],
  );

  if (unavailableReason) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-xs text-muted-foreground">
        <span>{UNAVAILABLE_MESSAGES[unavailableReason] ?? "Diff is not available."}</span>
        {webUrl ? (
          <button
            type="button"
            onClick={() => openExternalUrl(webUrl)}
            className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-secondary"
          >
            Open in browser
          </button>
        ) : null}
      </div>
    );
  }

  const truncated = lines.length > MAX_RENDERED_DIFF_LINES;
  const rendered = truncated ? lines.slice(0, MAX_RENDERED_DIFF_LINES) : lines;

  return (
    <div className="font-mono text-[11px] leading-4">
      {rendered.map((line, index) => (
        <DiffRow key={index} line={line} />
      ))}
      {truncated ? (
        <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
          Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
        </p>
      ) : null}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const rowCls =
    line.kind === "add"
      ? "bg-green-50 text-green-900"
      : line.kind === "del"
        ? "bg-red-50 text-red-900"
        : "";
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <div className={`grid grid-cols-[3rem_3rem_1fr] ${rowCls}`}>
      <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.baseLine ?? ""}
      </span>
      <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.targetLine ?? ""}
      </span>
      <span className="whitespace-pre pl-1">
        {marker}
        {line.text}
      </span>
    </div>
  );
}
