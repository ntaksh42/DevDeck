import { type CommitSummary } from "@/lib/azdoCommands";
import { extractWorkItemMentions } from "@/lib/crossLinks";

// The default traceability rule: a commit is linked when its message mentions a
// work item (`AB#NNN`) or it is part of a pull request. `prCount` is the cached
// related-PR count; `undefined` means the lookup has not finished, so the commit
// is never reported as unlinked on incomplete information.
export function isUnlinkedCommit(commit: CommitSummary, prCount: number | undefined): boolean {
  return prCount === 0 && extractWorkItemMentions([commit.comment]).length === 0;
}
