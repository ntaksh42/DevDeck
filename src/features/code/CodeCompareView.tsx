import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  compareRepoRevisions,
  getRepoRevisionFileDiff,
  listRepoTags,
  type ChangedFile,
  type RevisionType,
} from "@/lib/azdoCommands";
import { ErrorState, PreviewEmptyState } from "@/components/StateDisplay";
import { DiffView, type DiffViewMode } from "@/components/DiffView";
import { type RepoOption } from "./codeBrowseShared";
import { RevisionPicker } from "./RevisionPicker";

const VIEW_MODE_KEY = "azdodeck:view:compareViewMode";
const IGNORE_WHITESPACE_KEY = "azdodeck:view:compareIgnoreWhitespace";
const WORD_WRAP_KEY = "azdodeck:view:compareWordWrap";

function loadBoolean(key: string): boolean {
  return window.localStorage.getItem(key) === "true";
}

function loadViewMode(): DiffViewMode {
  return window.localStorage.getItem(VIEW_MODE_KEY) === "split" ? "split" : "unified";
}

type ChangeBadge = { label: string; cls: string };

const ADD_BADGE: ChangeBadge = { label: "A", cls: "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300" };
const DELETE_BADGE: ChangeBadge = { label: "D", cls: "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300" };
const RENAME_BADGE: ChangeBadge = { label: "R", cls: "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300" };
const EDIT_BADGE: ChangeBadge = { label: "M", cls: "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300" };

function changeBadge(changeType: string): ChangeBadge {
  const tokens = changeType.toLowerCase().split(",").map((token) => token.trim());
  if (tokens.includes("rename")) return RENAME_BADGE;
  if (tokens.includes("delete")) return DELETE_BADGE;
  if (tokens.includes("add") || tokens.includes("undelete")) return ADD_BADGE;
  return EDIT_BADGE;
}

// Files > Compare: pick any two revisions (branch, tag, or commit) of a
// repository, see the changed files between them, and drill into one for its
// diff. Unrelated to the currently browsed branch/file other than defaulting
// the target revision and preselecting the open file when it is among the
// changed files.
export function CodeCompareView({
  organizationId,
  repo,
  branch,
  branchOptions,
  selectedPath,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  branchOptions: { value: string; label: string }[];
  selectedPath: string | null;
}) {
  const [baseType, setBaseType] = useState<RevisionType>("branch");
  const [baseValue, setBaseValue] = useState("");
  const [targetType, setTargetType] = useState<RevisionType>("branch");
  const [targetValue, setTargetValue] = useState(branch);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const [viewMode, setViewMode] = useState<DiffViewMode>(() => loadViewMode());
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(() => loadBoolean(IGNORE_WHITESPACE_KEY));
  const [wordWrap, setWordWrap] = useState(() => loadBoolean(WORD_WRAP_KEY));

  const tagsQuery = useQuery({
    queryKey: ["repoTags", organizationId, repo.repositoryId],
    queryFn: () => listRepoTags({ organizationId, project: repo.projectId, repository: repo.repositoryId }),
    staleTime: 5 * 60_000,
  });
  const tagOptions = useMemo(
    () => (tagsQuery.data ?? []).map((tag) => ({ value: tag.name, label: tag.name })),
    [tagsQuery.data],
  );

  const canCompare = !!baseValue.trim() && !!targetValue.trim();
  const compareQuery = useQuery({
    queryKey: [
      "compareRevisions",
      organizationId,
      repo.repositoryId,
      baseType,
      baseValue,
      targetType,
      targetValue,
    ],
    queryFn: () =>
      compareRepoRevisions({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        baseRevision: baseValue.trim(),
        baseRevisionType: baseType,
        targetRevision: targetValue.trim(),
        targetRevisionType: targetType,
      }),
    enabled: canCompare,
    staleTime: 60_000,
  });
  const files = useMemo(() => compareQuery.data ?? [], [compareQuery.data]);

  // Reset the file selection whenever the revision pair changes, but
  // preselect the file currently open in the tree when it is part of the
  // changed set.
  useEffect(() => {
    setSelectedFilePath(selectedPath && files.some((file) => file.path === selectedPath) ? selectedPath : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const selectedFile = files.find((file) => file.path === selectedFilePath) ?? null;

  const diffQuery = useQuery({
    queryKey: [
      "revisionFileDiff",
      organizationId,
      repo.repositoryId,
      selectedFile?.path,
      baseType,
      baseValue,
      targetType,
      targetValue,
    ],
    queryFn: () =>
      getRepoRevisionFileDiff({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        filePath: selectedFile!.path,
        originalPath: selectedFile!.originalPath,
        changeType: selectedFile!.changeType,
        baseRevision: baseValue.trim(),
        baseRevisionType: baseType,
        targetRevision: targetValue.trim(),
        targetRevisionType: targetType,
      }),
    enabled: !!selectedFile,
    staleTime: 60_000,
  });

  function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-file-option]") ?? []);
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[index < 0 ? 0 : Math.min(index + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[index <= 0 ? 0 : index - 1]?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <RevisionPicker
          label="Base"
          type={baseType}
          value={baseValue}
          branchOptions={branchOptions}
          tagOptions={tagOptions}
          onTypeChange={(type) => {
            setBaseType(type);
            setBaseValue("");
          }}
          onValueChange={setBaseValue}
        />
        <span className="text-muted-foreground" aria-hidden="true">→</span>
        <RevisionPicker
          label="Target"
          type={targetType}
          value={targetValue}
          branchOptions={branchOptions}
          tagOptions={tagOptions}
          onTypeChange={(type) => {
            setTargetType(type);
            setTargetValue("");
          }}
          onValueChange={setTargetValue}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border">
          {!canCompare ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">
              Pick a base and target revision to compare.
            </div>
          ) : compareQuery.isLoading ? (
            <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
            </div>
          ) : compareQuery.isError ? (
            <ErrorState message={commandErrorMessage(compareQuery.error)} onRetry={() => compareQuery.refetch()} />
          ) : files.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No differences.</div>
          ) : (
            <ul
              ref={listRef}
              role="listbox"
              aria-label="Changed files"
              onKeyDown={onListKeyDown}
              className="py-1"
            >
              {files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  selected={file.path === selectedFilePath}
                  onSelect={() => setSelectedFilePath(file.path)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!selectedFile ? (
            <PreviewEmptyState message="Select a changed file to view its diff." />
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-2 py-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={selectedFile.path}>
                  {selectedFile.path}
                </span>
                <button
                  type="button"
                  aria-pressed={ignoreWhitespace}
                  onClick={() =>
                    setIgnoreWhitespace((value) => {
                      const next = !value;
                      window.localStorage.setItem(IGNORE_WHITESPACE_KEY, String(next));
                      return next;
                    })
                  }
                  title="Ignore leading/trailing whitespace differences"
                  className={`shrink-0 rounded border px-2 py-px text-[11px] font-medium ${
                    ignoreWhitespace
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  Ignore whitespace
                </button>
                <button
                  type="button"
                  aria-pressed={wordWrap}
                  onClick={() =>
                    setWordWrap((value) => {
                      const next = !value;
                      window.localStorage.setItem(WORD_WRAP_KEY, String(next));
                      return next;
                    })
                  }
                  title="Wrap long lines"
                  className={`shrink-0 rounded border px-2 py-px text-[11px] font-medium ${
                    wordWrap
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  Wrap
                </button>
                <div
                  className="flex shrink-0 items-center gap-0.5 rounded border border-border bg-card p-0.5"
                  role="tablist"
                  aria-label="Diff view mode"
                >
                  {(["unified", "split"] as DiffViewMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={viewMode === mode}
                      onClick={() => {
                        setViewMode(mode);
                        window.localStorage.setItem(VIEW_MODE_KEY, mode);
                      }}
                      className={`rounded px-2 py-px text-[11px] font-medium ${
                        viewMode === mode
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {mode === "unified" ? "Unified" : "Split"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {diffQuery.isLoading ? (
                  <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
                  </div>
                ) : diffQuery.isError ? (
                  <ErrorState message={commandErrorMessage(diffQuery.error)} onRetry={() => diffQuery.refetch()} />
                ) : diffQuery.data ? (
                  <DiffView
                    key={selectedFile.path}
                    baseContent={diffQuery.data.baseContent}
                    targetContent={diffQuery.data.targetContent}
                    baseUnavailableReason={diffQuery.data.baseUnavailableReason}
                    targetUnavailableReason={diffQuery.data.targetUnavailableReason}
                    viewMode={viewMode}
                    ignoreWhitespace={ignoreWhitespace}
                    wordWrap={wordWrap}
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: ChangedFile;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = changeBadge(file.changeType);
  return (
    <li>
      <button
        type="button"
        data-file-option
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        title={file.path}
        className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-secondary ${
          selected ? "bg-secondary font-medium" : ""
        }`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold ${badge.cls}`}
          aria-hidden="true"
        >
          {badge.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
      </button>
    </li>
  );
}
