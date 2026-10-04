import { useState } from "react";
import { Loader2 } from "lucide-react";
import { commandErrorMessage, type RepoFileVersion } from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { CompareDiffBody, type CompareDiffMode } from "./CompareDiffBody";
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
  const [mode, setMode] = useState<CompareDiffMode>("unified");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [wrap, setWrap] = useState(false);

  // A file absent on the base ref (404) is treated as empty, i.e. fully added.
  const baseContent = baseQuery.data?.content ?? "";
  const targetContent = targetQuery.data?.content ?? "";
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
        <div className="ml-auto flex items-center gap-2 text-xs">
          <div role="group" aria-label="Diff layout" className="flex overflow-hidden rounded border border-border">
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
            <input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />
            Wrap
          </label>
        </div>
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
        ) : (
          <CompareDiffBody
            base={baseContent}
            target={targetContent}
            mode={mode}
            ignoreWhitespace={ignoreWhitespace}
            wrap={wrap}
            baseLabel={baseLabel}
            targetLabel={branch}
          />
        )}
      </div>
    </div>
  );
}
