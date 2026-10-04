import { useQuery } from "@tanstack/react-query";
import { GitBranch, Loader2, Tag } from "lucide-react";
import { type CommitSummary, getCommitContainingRefs } from "@/lib/azdoCommands";
import { PreviewBand } from "@/components/PreviewBand";

function RefChip({ name, kind }: { name: string; kind: "branch" | "tag" }) {
  const Icon = kind === "branch" ? GitBranch : Tag;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

// The branches and tags that contain the selected commit. Azure DevOps has no
// single endpoint for this, so the backend checks a bounded number of refs and
// reports how many it covered. Hidden when the provider cannot answer (GitHub)
// or the lookup fails: this is supplementary detail, not something to block on.
export function CommitContainingRefsPanel({ commit }: { commit: CommitSummary }) {
  const query = useQuery({
    queryKey: [
      "commitContainingRefs",
      commit.organizationId,
      commit.repositoryId,
      commit.commitId,
    ],
    queryFn: () =>
      getCommitContainingRefs({
        organizationId: commit.organizationId,
        projectId: commit.projectId,
        repositoryId: commit.repositoryId,
        commitId: commit.commitId,
      }),
    staleTime: 10 * 60_000,
    retry: false,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Finding branches and
        tags…
      </div>
    );
  }
  const refs = query.data;
  if (!refs) return null;

  const partial = refs.checked < refs.total;
  return (
    <div className="border-t border-border">
      <PreviewBand>Contained in</PreviewBand>
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        {refs.branches.map((name) => (
          <RefChip key={`b:${name}`} name={name} kind="branch" />
        ))}
        {refs.tags.map((name) => (
          <RefChip key={`t:${name}`} name={name} kind="tag" />
        ))}
        {refs.branches.length === 0 && refs.tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {partial ? "No checked branch or tag contains this commit." : "No branch or tag."}
          </span>
        ) : null}
      </div>
      {partial ? (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">
          Checked {refs.checked} of {refs.total} branches and tags; others may also contain it.
        </p>
      ) : null}
    </div>
  );
}
