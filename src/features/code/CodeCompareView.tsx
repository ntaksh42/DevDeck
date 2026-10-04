import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  compareRepoRevisions,
  listRepoTags,
} from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { FilterableSelect } from "@/features/pipelines/FilterableSelect";
import { CompareDiffBody, type CompareDiffMode } from "./CompareDiffBody";
import { type RepoOption, useRepoFile } from "./codeBrowseShared";
import { fileVersion, isUnderFolder, revisionFor } from "./compareRevisions";
import { RevisionChangeList } from "./RevisionChangeList";

const TAG_LIST_ID = "code-compare-tags";
const refInputClass =
  "h-8 w-40 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

// Files > Compare: compares any two revisions (each a branch, or a commit SHA /
// tag typed into its ref box). Lists the files changed between them (limited to
// the selected folder, if one is selected) and shows the diff of the chosen
// file, reusing the shared diff builder and renderer.
export function CodeCompareView({
  organizationId,
  repo,
  branch,
  branchOptions,
  baseBranch,
  onBaseBranchChange,
  path,
  isFolder,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  branchOptions: { value: string; label: string }[];
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  path: string;
  isFolder: boolean;
}) {
  const [baseRefText, setBaseRefText] = useState("");
  const [targetBranch, setTargetBranch] = useState(branch);
  const [targetRefText, setTargetRefText] = useState("");
  // The target follows the browsed branch until the user picks another one.
  useEffect(() => setTargetBranch(branch), [branch]);

  const base = revisionFor(baseRefText, baseBranch);
  const target = revisionFor(targetRefText, targetBranch);
  const baseLabel = base?.value ?? "";
  const targetLabel = target?.value ?? "";

  const [mode, setMode] = useState<CompareDiffMode>("unified");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [wrap, setWrap] = useState(false);

  // The file whose diff is shown: the opened file, or one picked from the list.
  const [diffPath, setDiffPath] = useState<string | null>(isFolder ? null : path);
  useEffect(() => setDiffPath(isFolder ? null : path), [path, isFolder]);

  const tagsQuery = useQuery({
    queryKey: ["repoTags", organizationId, repo.repositoryId],
    queryFn: () =>
      listRepoTags({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
      }),
    staleTime: 60_000,
  });

  const comparisonReady = !!base && !!target && baseLabel !== targetLabel;
  const comparison = useQuery({
    queryKey: [
      "repoCompare",
      organizationId,
      repo.repositoryId,
      base?.type,
      baseLabel,
      target?.type,
      targetLabel,
    ],
    queryFn: () =>
      compareRepoRevisions({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        baseType: base!.type,
        base: base!.value,
        targetType: target!.type,
        target: target!.value,
      }),
    enabled: comparisonReady,
    staleTime: 60_000,
  });
  const folder = isFolder ? path : "/";
  const changes = (comparison.data?.changes ?? []).filter((change) =>
    isUnderFolder(change.path, folder),
  );

  // A branch side reads the file at that branch tip; a tag / commit side reads
  // it at that version (the branch argument is then only part of the cache key).
  const baseQuery = useRepoFile(
    organizationId,
    repo,
    base?.type === "branch" ? base.value : branch,
    diffPath ?? path,
    base ? fileVersion(base) : undefined,
  );
  const targetQuery = useRepoFile(
    organizationId,
    repo,
    target?.type === "branch" ? target.value : branch,
    diffPath ?? path,
    target ? fileVersion(target) : undefined,
  );

  // A file absent on one revision (404) is treated as empty, i.e. fully added/removed.
  const baseContent = baseQuery.data?.content ?? "";
  const targetContent = targetQuery.data?.content ?? "";

  let diffArea;
  if (!base || !target) {
    diffArea = (
      <div className="px-3 py-3 text-sm text-muted-foreground">
        Pick a base and a target (branch, or a commit SHA / tag) to compare.
      </div>
    );
  } else if (!diffPath) {
    diffArea = (
      <div className="px-3 py-3 text-sm text-muted-foreground">
        Select a changed file to see its diff.
      </div>
    );
  } else if (baseQuery.isLoading || targetQuery.isLoading) {
    diffArea = (
      <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  } else if (targetQuery.isError) {
    diffArea = <ErrorState message={commandErrorMessage(targetQuery.error)} />;
  } else if (baseQuery.data?.isBinary || targetQuery.data?.isBinary) {
    diffArea = (
      <div className="px-3 py-3 text-sm text-muted-foreground">Binary file cannot be compared.</div>
    );
  } else if (baseQuery.data?.tooLarge || targetQuery.data?.tooLarge) {
    diffArea = (
      <div className="px-3 py-3 text-sm text-muted-foreground">File is too large to compare.</div>
    );
  } else {
    diffArea = (
      <CompareDiffBody
        base={baseContent}
        target={targetContent}
        mode={mode}
        ignoreWhitespace={ignoreWhitespace}
        wrap={wrap}
        baseLabel={baseLabel}
        targetLabel={targetLabel}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <datalist id={TAG_LIST_ID}>
        {(tagsQuery.data ?? []).map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="text-muted-foreground">Compare base</span>
        <div className="w-48">
          <FilterableSelect
            value={baseBranch}
            options={branchOptions}
            onChange={onBaseBranchChange}
            disabled={!!baseRefText.trim()}
            placeholder="Select a base branch"
            ariaLabel="Compare base branch"
          />
        </div>
        <input
          type="text"
          list={TAG_LIST_ID}
          value={baseRefText}
          onChange={(event) => setBaseRefText(event.target.value)}
          placeholder="Commit SHA or tag"
          aria-label="Compare base commit or tag"
          className={refInputClass}
        />
        <span className="text-muted-foreground">→ target</span>
        <div className="w-48">
          <FilterableSelect
            value={targetBranch}
            options={branchOptions}
            onChange={setTargetBranch}
            disabled={!!targetRefText.trim()}
            placeholder="Select a target branch"
            ariaLabel="Compare target branch"
          />
        </div>
        <input
          type="text"
          list={TAG_LIST_ID}
          value={targetRefText}
          onChange={(event) => setTargetRefText(event.target.value)}
          placeholder="Commit SHA or tag"
          aria-label="Compare target commit or tag"
          className={refInputClass}
        />
        <div className="ml-auto flex items-center gap-2 text-xs">
          <div
            role="group"
            aria-label="Diff layout"
            className="flex overflow-hidden rounded border border-border"
          >
            {(["unified", "split"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`px-2 py-0.5 ${mode === value ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                {value === "unified" ? "Unified" : "Side by side"}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={(event) => setIgnoreWhitespace(event.target.checked)}
            />
            Ignore whitespace
          </label>
          <label className="flex cursor-pointer items-center gap-1 text-muted-foreground">
            <input
              type="checkbox"
              checked={wrap}
              onChange={(event) => setWrap(event.target.checked)}
            />
            Wrap
          </label>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {comparisonReady ? (
          <div className="flex w-64 shrink-0 flex-col border-r border-border">
            {comparison.isLoading ? (
              <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading changes…
              </div>
            ) : comparison.isError ? (
              <div className="px-3 py-2 text-xs text-destructive">
                {commandErrorMessage(comparison.error)}
              </div>
            ) : (
              <RevisionChangeList
                changes={changes}
                truncated={comparison.data?.truncated ?? false}
                selectedPath={diffPath}
                onSelect={setDiffPath}
              />
            )}
          </div>
        ) : null}
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">{diffArea}</div>
      </div>
    </div>
  );
}
