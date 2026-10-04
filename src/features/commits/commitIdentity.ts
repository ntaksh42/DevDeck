import type { CommitSummary } from "@/lib/azdoCommands";

type Identity = Pick<
  CommitSummary,
  "authorName" | "authorEmail" | "committerName" | "committerEmail"
>;

// Whether the committer is someone other than the author (rebases, cherry-picks,
// patches applied by a maintainer). Emails identify a person best; names are the
// fallback when either email is missing.
export function hasDistinctCommitter(commit: Identity): boolean {
  const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  const committerEmail = norm(commit.committerEmail);
  const authorEmail = norm(commit.authorEmail);
  if (committerEmail && authorEmail) return committerEmail !== authorEmail;
  const committerName = norm(commit.committerName);
  const authorName = norm(commit.authorName);
  if (committerName && authorName) return committerName !== authorName;
  return false;
}
