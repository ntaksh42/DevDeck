import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, ExternalLink, Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  getCommitChanges,
  getCommitFileDiff,
  type CommitChangedFile,
} from "@/lib/azdoCommands";
import { buildDiffLines, collapseDiff, type DiffLine } from "@/lib/diffView";
import { openExternalUrl } from "@/lib/openExternal";

const MAX_RENDERED_DIFF_LINES = 2000;

type ChangeBadge = { label: string; cls: string };
const ADD_BADGE: ChangeBadge = { label: "A", cls: "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300" };
const DELETE_BADGE: ChangeBadge = { label: "D", cls: "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" };
const RENAME_BADGE: ChangeBadge = {
  label: "R",
  cls: "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300",
};
const EDIT_BADGE: ChangeBadge = { label: "M", cls: "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300" };

function changeTypeBadge(changeType: string): ChangeBadge {
  const tokens = changeType.toLowerCase().split(",").map((token) => token.trim());
  if (tokens.includes("rename")) return RENAME_BADGE;
  if (tokens.includes("delete")) return DELETE_BADGE;
  if (tokens.includes("add") || tokens.includes("undelete")) return ADD_BADGE;
  return EDIT_BADGE;
}

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  binary: "Binary file — diff is not available.",
  tooLarge: "File is too large to diff in the app.",
  missing: "File content could not be loaded.",
};

function fileName(path: string): string {
  return path.replace(/^\/+/, "").split("/").pop() ?? path;
}

/** Deep-links to a file's diff on the Azure DevOps commit page. The commit web
 * URL already targets the correct org/project/repo/commit; appending `?path=`
 * focuses that file, matching how the web UI links into a commit. */
function fileDiffUrl(commitWebUrl: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${commitWebUrl}?path=${encodeURIComponent(normalized)}`;
}

export function CommitFilesPanel({
  organizationId,
  projectId,
  repositoryId,
  commitId,
  commitWebUrl = null,
}: {
  organizationId: string;
  projectId: string;
  repositoryId: string;
  commitId: string;
  commitWebUrl?: string | null;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const changesQuery = useQuery({
    queryKey: ["commitChanges", organizationId, projectId, repositoryId, commitId],
    queryFn: () => getCommitChanges({ organizationId, projectId, repositoryId, commitId }),
    staleTime: 5 * 60_000,
  });

  const changes = changesQuery.data ?? null;
  const files = changes?.files ?? [];
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;

  const diffQuery = useQuery({
    queryKey: ["commitFileDiff", organizationId, projectId, repositoryId, commitId, selectedPath],
    queryFn: () =>
      getCommitFileDiff({
        organizationId,
        projectId,
        repositoryId,
        commitId,
        parentCommitId: changes?.parentCommitId ?? null,
        filePath: (selectedFile as CommitChangedFile).path,
        originalPath: selectedFile?.originalPath ?? null,
        changeType: selectedFile?.changeType ?? "edit",
      }),
    enabled: !!selectedFile && !!changes,
    staleTime: 5 * 60_000,
  });

  if (changesQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading changed files…
      </div>
    );
  }
  if (changesQuery.isError) {
    return (
      <p className="px-3 py-3 text-xs text-destructive">
        {commandErrorMessage(changesQuery.error)}
      </p>
    );
  }
  if (files.length === 0) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">No changed files.</p>;
  }

  return (
    <div className="border-t border-border">
      <div className="border-b border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {files.length} changed file{files.length === 1 ? "" : "s"}
      </div>
      <ul>
        {files.map((file) => {
          const badge = changeTypeBadge(file.changeType);
          const selected = file.path === selectedPath;
          return (
            <li key={file.path}>
              <div
                className={`flex items-center pr-1 ${
                  selected ? "bg-secondary" : "hover:bg-muted/50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedPath(selected ? null : file.path)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1 text-left text-xs"
                  title={file.path}
                >
                  <span
                    className={`inline-flex w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
                    aria-label={file.changeType}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono">{fileName(file.path)}</span>
                </button>
                {commitWebUrl ? (
                  <button
                    type="button"
                    onClick={() => openExternalUrl(fileDiffUrl(commitWebUrl, file.path))}
                    title={`Open diff in Azure DevOps: ${file.path}`}
                    aria-label={`Open diff for ${fileName(file.path)} in Azure DevOps`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {selected ? (
                <div className="border-y border-border">
                  {diffQuery.isLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading
                      diff…
                    </div>
                  ) : diffQuery.isError ? (
                    <p className="px-3 py-2 text-xs text-destructive">
                      {commandErrorMessage(diffQuery.error)}
                    </p>
                  ) : diffQuery.data ? (
                    <CommitDiffView
                      baseContent={diffQuery.data.baseContent}
                      targetContent={diffQuery.data.targetContent}
                      baseUnavailableReason={diffQuery.data.baseUnavailableReason}
                      targetUnavailableReason={diffQuery.data.targetUnavailableReason}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function rowBackground(kind: DiffLine["kind"]): string {
  return kind === "add"
    ? "bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-200"
    : kind === "del"
      ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
      : "";
}

function CommitDiffView({
  baseContent,
  targetContent,
  baseUnavailableReason,
  targetUnavailableReason,
}: {
  baseContent: string | null;
  targetContent: string | null;
  baseUnavailableReason: string | null;
  targetUnavailableReason: string | null;
}) {
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(() => new Set());

  const baseBlocked = baseUnavailableReason != null;
  const targetBlocked = targetUnavailableReason != null;
  const fatalReason =
    baseBlocked && targetBlocked ? (targetUnavailableReason ?? baseUnavailableReason) : null;
  const baseText = baseBlocked ? "" : baseContent ?? "";
  const targetText = targetBlocked ? "" : targetContent ?? "";

  const collapsed = useMemo(() => {
    if (fatalReason) return [];
    const lines = buildDiffLines(baseText, targetText);
    return collapseDiff(lines, (line) => line.kind === "context");
  }, [baseText, targetText, fatalReason]);

  if (fatalReason) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {UNAVAILABLE_MESSAGES[fatalReason] ?? "Diff is not available."}
      </p>
    );
  }

  const partialNote = targetBlocked
    ? `New version unavailable (${UNAVAILABLE_MESSAGES[targetUnavailableReason!] ?? targetUnavailableReason}); showing the previous version.`
    : baseBlocked
      ? `Previous version unavailable (${UNAVAILABLE_MESSAGES[baseUnavailableReason!] ?? baseUnavailableReason}); showing the new file.`
      : null;

  let rendered = 0;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < collapsed.length && rendered < MAX_RENDERED_DIFF_LINES; i++) {
    const item = collapsed[i];
    if (item.type === "gap" && !expandedGaps.has(i)) {
      out.push(
        <button
          key={`gap${i}`}
          type="button"
          onClick={() => setExpandedGaps((prev) => new Set(prev).add(i))}
          className="flex w-full items-center justify-center gap-1 border-y border-border/60 bg-muted/40 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/70"
        >
          <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
          Expand {item.rows.length} unchanged line{item.rows.length === 1 ? "" : "s"}
        </button>,
      );
      continue;
    }
    const rows = item.type === "row" ? [item.row] : item.rows;
    for (const line of rows) {
      if (rendered >= MAX_RENDERED_DIFF_LINES) break;
      const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      out.push(
        <div
          key={`l${i}-${rendered}`}
          className={`grid grid-cols-[3rem_3rem_1fr] ${rowBackground(line.kind)}`}
        >
          <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
            {line.baseLine ?? ""}
          </span>
          <span className="select-none border-r border-border/60 pr-1 text-right text-muted-foreground/70">
            {line.targetLine ?? ""}
          </span>
          <span className="whitespace-pre-wrap break-all pl-1">
            {marker}
            {line.text}
          </span>
        </div>,
      );
      rendered += 1;
    }
  }

  return (
    <div className="font-mono text-[11px] leading-4">
      {partialNote ? (
        <p className="border-b border-border bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
          {partialNote}
        </p>
      ) : null}
      {out}
      {rendered >= MAX_RENDERED_DIFF_LINES ? (
        <p className="px-2 py-1 text-[11px] italic text-muted-foreground">
          Diff truncated to the first {MAX_RENDERED_DIFF_LINES} lines.
        </p>
      ) : null}
    </div>
  );
}
