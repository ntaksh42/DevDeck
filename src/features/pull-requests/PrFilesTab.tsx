import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import {
  commandErrorMessage,
  getPullRequestFileDiff,
  listPullRequestChanges,
  postPullRequestComment,
  setPullRequestThreadStatus,
  type PrChangedFile,
  type PrLocatorInput,
  type PrThread,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import {
  buildDiffLines,
  buildSideBySideRows,
  type DiffLine,
  type SideBySideCell,
} from "@/lib/diffView";
import { openExternalUrl } from "@/lib/openExternal";
import { LoadingState, ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { PrThreadCard, isThreadResolved } from "./PrThreadCard";

const MAX_RENDERED_DIFF_LINES = 2000;

type ViewMode = "unified" | "split";

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

function prLocator(pr: ReviewPullRequestSummary): PrLocatorInput {
  return {
    organizationId: pr.organizationId,
    projectId: pr.projectId,
    repositoryId: pr.repositoryId,
    pullRequestId: pr.pullRequestId,
  };
}

export function PrFilesTab({
  pr,
  threads,
}: {
  pr: ReviewPullRequestSummary;
  threads: PrThread[] | undefined;
}) {
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  // Target-side line number where a new inline comment is being drafted.
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const changesQuery = useQuery({
    queryKey: ["prChanges", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestChanges(prLocator(pr)),
    staleTime: 60_000,
  });

  const changes = changesQuery.data ?? null;
  const files = changes?.files ?? [];
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;

  // Reset selection state when switching PRs.
  useEffect(() => {
    setSelectedPath(null);
    setCommentLine(null);
    setActionError(null);
  }, [pr.pullRequestId, pr.repositoryId]);

  useEffect(() => {
    setCommentLine(null);
  }, [selectedPath]);

  function invalidateReview() {
    void queryClient.invalidateQueries({ queryKey: ["prReview"] });
  }

  const commentMutation = useMutation({
    mutationFn: postPullRequestComment,
    onSuccess: () => {
      setActionError(null);
      setCommentLine(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const statusMutation = useMutation({
    mutationFn: setPullRequestThreadStatus,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const mutationsBusy = commentMutation.isPending || statusMutation.isPending;

  const activeThreadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads ?? []) {
      if (!thread.filePath) continue;
      if (isThreadResolved(thread)) continue;
      counts.set(thread.filePath, (counts.get(thread.filePath) ?? 0) + 1);
    }
    return counts;
  }, [threads]);

  // Threads anchored to a right-side line of the selected file.
  const threadsByLine = useMemo(() => {
    const map = new Map<number, PrThread[]>();
    if (!selectedFile) return map;
    for (const thread of threads ?? []) {
      if (thread.filePath !== selectedFile.path || thread.rightLine == null) continue;
      const list = map.get(thread.rightLine) ?? [];
      list.push(thread);
      map.set(thread.rightLine, list);
    }
    return map;
  }, [threads, selectedFile]);

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
        ...prLocator(pr),
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

  function postInlineComment(content: string) {
    if (!selectedFile || commentLine == null) return;
    commentMutation.mutate({
      ...prLocator(pr),
      content,
      filePath: selectedFile.path,
      rightLine: commentLine,
    });
  }

  function replyToThread(thread: PrThread, content: string) {
    commentMutation.mutate({
      ...prLocator(pr),
      threadId: thread.id,
      parentCommentId: thread.comments[0]?.id ?? 1,
      content,
    });
  }

  function toggleThreadStatus(thread: PrThread) {
    statusMutation.mutate({
      ...prLocator(pr),
      threadId: thread.id,
      status: isThreadResolved(thread) ? "active" : "closed",
    });
  }

  // Inline block rendered under a right-side line: existing threads + comment box.
  function lineAttachments(rightLine: number | null) {
    if (rightLine == null) return null;
    const lineThreads = threadsByLine.get(rightLine) ?? [];
    const drafting = commentLine === rightLine;
    if (lineThreads.length === 0 && !drafting) return null;
    return (
      <div className="space-y-1 border-y border-border bg-muted/30 px-2 py-1.5 font-sans whitespace-normal">
        {lineThreads.map((thread) => (
          <PrThreadCard
            key={thread.id}
            thread={thread}
            busy={mutationsBusy}
            showFilePath={false}
            onReply={(content) => replyToThread(thread, content)}
            onToggleStatus={() => toggleThreadStatus(thread)}
          />
        ))}
        {drafting ? (
          <InlineCommentBox
            busy={commentMutation.isPending}
            onSubmit={postInlineComment}
            onCancel={() => setCommentLine(null)}
          />
        ) : null}
      </div>
    );
  }

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

      {/* Diff toolbar */}
      {selectedFile ? (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
          <span className="text-[11px] text-muted-foreground">
            Click a line number's + to comment
          </span>
          <div
            className="flex items-center gap-0.5 rounded border border-border bg-gray-50 p-0.5"
            role="tablist"
            aria-label="Diff view mode"
          >
            {(["unified", "split"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`rounded px-2 py-px text-[11px] font-medium ${
                  viewMode === mode
                    ? "bg-white text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode === "unified" ? "Unified" : "Split"}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="m-2 shrink-0 rounded-md border border-destructive/30 bg-red-50 px-2 py-1 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}

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
            viewMode={viewMode}
            lineAttachments={lineAttachments}
            onStartComment={(line) => {
              setActionError(null);
              setCommentLine(line);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function InlineCommentBox({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");

  function submit() {
    if (!text.trim()) return;
    onSubmit(text);
  }

  return (
    <div className="rounded-md border border-border bg-white px-2 py-1.5">
      <textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        rows={2}
        placeholder="Comment on this line… (Ctrl+Enter to post)"
        aria-label="New inline comment"
        className="w-full resize-y rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-1 flex items-center justify-end gap-1">
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border bg-white px-1.5 py-px text-[10px] hover:bg-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!text.trim() || busy}
          onClick={submit}
          className="rounded border border-border bg-white px-1.5 py-px text-[10px] hover:bg-secondary disabled:opacity-50"
        >
          Comment
        </button>
      </div>
    </div>
  );
}

function DiffContent({
  baseContent,
  targetContent,
  unavailableReason,
  webUrl,
  viewMode,
  lineAttachments,
  onStartComment,
}: {
  baseContent: string | null;
  targetContent: string | null;
  unavailableReason: string | null;
  webUrl: string | null;
  viewMode: ViewMode;
  lineAttachments: (rightLine: number | null) => ReactNode;
  onStartComment: (rightLine: number) => void;
}) {
  const unified = useMemo(
    () =>
      unavailableReason || viewMode !== "unified"
        ? []
        : buildDiffLines(baseContent ?? "", targetContent ?? ""),
    [baseContent, targetContent, unavailableReason, viewMode],
  );
  const split = useMemo(
    () =>
      unavailableReason || viewMode !== "split"
        ? []
        : buildSideBySideRows(baseContent ?? "", targetContent ?? ""),
    [baseContent, targetContent, unavailableReason, viewMode],
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

  if (viewMode === "split") {
    const truncated = split.length > MAX_RENDERED_DIFF_LINES;
    const rendered = truncated ? split.slice(0, MAX_RENDERED_DIFF_LINES) : split;
    return (
      <div className="font-mono text-[11px] leading-4">
        {rendered.map((row, index) => (
          <div key={index}>
            <div className="grid grid-cols-2">
              <SplitCell cell={row.left} side="left" onStartComment={onStartComment} />
              <SplitCell cell={row.right} side="right" onStartComment={onStartComment} />
            </div>
            {lineAttachments(row.right?.line ?? null)}
          </div>
        ))}
        {truncated ? <TruncationNote /> : null}
      </div>
    );
  }

  const truncated = unified.length > MAX_RENDERED_DIFF_LINES;
  const rendered = truncated ? unified.slice(0, MAX_RENDERED_DIFF_LINES) : unified;
  return (
    <div className="font-mono text-[11px] leading-4">
      {rendered.map((line, index) => (
        <div key={index}>
          <DiffRow line={line} onStartComment={onStartComment} />
          {lineAttachments(line.targetLine)}
        </div>
      ))}
      {truncated ? <TruncationNote /> : null}
    </div>
  );
}

function TruncationNote() {
  return (
    <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
      Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
    </p>
  );
}

function rowBackground(kind: SideBySideCell["kind"] | DiffLine["kind"]): string {
  return kind === "add"
    ? "bg-green-50 text-green-900"
    : kind === "del"
      ? "bg-red-50 text-red-900"
      : "";
}

function CommentLineButton({ line, onStartComment }: { line: number; onStartComment: (line: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`Comment on line ${line}`}
      onClick={() => onStartComment(line)}
      className="invisible absolute inset-y-0 left-0 flex w-4 items-center justify-center rounded-sm bg-primary text-primary-foreground group-hover:visible"
    >
      <Plus className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

function DiffRow({
  line,
  onStartComment,
}: {
  line: DiffLine;
  onStartComment: (rightLine: number) => void;
}) {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <div className={`group grid grid-cols-[3rem_3rem_1fr] ${rowBackground(line.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {line.targetLine != null ? (
          <CommentLineButton line={line.targetLine} onStartComment={onStartComment} />
        ) : null}
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

function SplitCell({
  cell,
  side,
  onStartComment,
}: {
  cell: SideBySideCell | null;
  side: "left" | "right";
  onStartComment: (rightLine: number) => void;
}) {
  if (!cell) {
    return <div className="border-r border-border/60 bg-muted/20" aria-hidden="true" />;
  }
  return (
    <div className={`group grid min-w-0 grid-cols-[3rem_1fr] border-r border-border/60 ${rowBackground(cell.kind)}`}>
      <span className="relative select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
        {side === "right" ? (
          <CommentLineButton line={cell.line} onStartComment={onStartComment} />
        ) : null}
        {cell.line}
      </span>
      {/* Long lines are clipped in split view; switch to unified to scroll. */}
      <span className="overflow-hidden whitespace-pre pl-1" title={cell.text}>
        {cell.text}
      </span>
    </div>
  );
}
