import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { commandErrorMessage, type RepoFileVersion } from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { buildDiffLines, collapseDiff } from "@/lib/diffView";
import { DiffLineText } from "@/components/DiffLineText";
import { FilterableSelect } from "@/features/pipelines/FilterableSelect";
import { type RepoOption, useRepoFile } from "./codeBrowseShared";

// A 7-40 hex-digit ref is treated as a commit SHA; anything else as a tag.
function refVersion(ref: string): RepoFileVersion {
  return /^[0-9a-f]{7,40}$/i.test(ref)
    ? { versionType: "commit", version: ref }
    : { versionType: "tag", version: ref };
}

// Files > Compare: diffs the selected file between a chosen base (a branch, or
// a commit SHA / tag typed into the ref box) and the current branch, reusing
// the shared diff builder and renderer.
export function CodeCompareView({
  organizationId,
  repo,
  branch,
  branchOptions,
  baseBranch,
  onBaseBranchChange,
  path,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  branchOptions: { value: string; label: string }[];
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  path: string;
}) {
  // A typed commit SHA / tag overrides the branch picker as the base.
  const [baseRefText, setBaseRefText] = useState("");
  const baseRef = baseRefText.trim();
  const baseVersion = baseRef ? refVersion(baseRef) : undefined;
  const baseLabel = baseRef || baseBranch;
  const hasBase = !!baseLabel;

  const baseQuery = useRepoFile(
    organizationId,
    repo,
    baseVersion ? branch : baseBranch,
    path,
    baseVersion,
  );
  const targetQuery = useRepoFile(organizationId, repo, branch, path);

  // A file absent on the base ref (404) is treated as empty, i.e. fully added.
  const baseContent = baseQuery.data?.content ?? "";
  const targetContent = targetQuery.data?.content ?? "";
  const { rows, hasChanges } = useMemo(() => {
    if (!hasBase) return { rows: [], hasChanges: false };
    const diff = buildDiffLines(baseContent, targetContent);
    const changed = diff.some((line) => line.kind !== "context");
    return { rows: collapseDiff(diff, (line) => line.kind === "context"), hasChanges: changed };
  }, [hasBase, baseContent, targetContent]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="text-muted-foreground">Compare base</span>
        <div className="w-56">
          <FilterableSelect
            value={baseBranch}
            options={branchOptions}
            onChange={onBaseBranchChange}
            disabled={!!baseRef}
            placeholder="Select a base branch"
            ariaLabel="Compare base branch"
          />
        </div>
        <span className="text-xs text-muted-foreground">or</span>
        <input
          type="text"
          value={baseRefText}
          onChange={(event) => setBaseRefText(event.target.value)}
          placeholder="Commit SHA or tag"
          aria-label="Compare base commit or tag"
          className="h-8 w-44 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">→ {branch}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!hasBase ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            Pick a base branch, or type a commit SHA / tag, to compare this file against {branch}.
          </div>
        ) : baseQuery.isLoading || targetQuery.isLoading ? (
          <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : targetQuery.isError ? (
          <ErrorState message={commandErrorMessage(targetQuery.error)} />
        ) : baseQuery.data?.isBinary || targetQuery.data?.isBinary ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            Binary file cannot be compared.
          </div>
        ) : baseQuery.data?.tooLarge || targetQuery.data?.tooLarge ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            File is too large to compare.
          </div>
        ) : !hasChanges ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">
            No differences between {baseLabel} and {branch}.
          </div>
        ) : (
          <div className="font-mono text-[12px] leading-5">
            {rows.map((item, index) =>
              item.type === "gap" ? (
                <div
                  key={`gap-${index}`}
                  className="bg-muted/40 px-3 py-0.5 text-center text-[11px] text-muted-foreground"
                >
                  {item.rows.length} unchanged lines hidden
                </div>
              ) : (
                <div
                  key={`row-${index}`}
                  className={`grid grid-cols-[3rem_3rem_1fr] ${rowBackground(item.row.kind)}`}
                >
                  <span className="select-none px-1 text-right text-muted-foreground">
                    {item.row.baseLine ?? ""}
                  </span>
                  <span className="select-none px-1 text-right text-muted-foreground">
                    {item.row.targetLine ?? ""}
                  </span>
                  <span className="whitespace-pre px-2">
                    {marker(item.row.kind)}
                    <DiffLineText
                      segments={item.row.segments}
                      text={item.row.text}
                      kind={item.row.kind}
                    />
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function rowBackground(kind: "context" | "add" | "del"): string {
  if (kind === "add") return "bg-green-100/60 dark:bg-green-900/30";
  if (kind === "del") return "bg-red-100/60 dark:bg-red-900/30";
  return "";
}

function marker(kind: "context" | "add" | "del"): string {
  if (kind === "add") return "+ ";
  if (kind === "del") return "- ";
  return "  ";
}
