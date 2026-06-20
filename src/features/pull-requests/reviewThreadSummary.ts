import type { PullRequestReview } from "@/lib/azdoCommands";

export type ThreadSummary = {
  // Open (unresolved) discussion threads that carry at least one comment.
  unresolved: number;
  // Whether any comment mentions the current user.
  mentionsMe: boolean;
  // Author of the most recent comment, for "who is waiting" context.
  lastCommenter: string | null;
};

// Azure DevOps stores mentions in comment content as `@<GUID>`. Matching the
// user's id substring (case-insensitive) catches it without depending on the
// exact bracket form (mirrors the backend's mention detection).
function contentMentions(content: string | null, myUserId: string | null): boolean {
  if (!content || !myUserId) return false;
  return content.toLowerCase().includes(myUserId.toLowerCase());
}

// Derives the unresolved-thread count, a mention flag, and the last commenter
// from a PR review's threads. Threads with no comments (system threads) are
// ignored for both the count and the last-commenter.
export function summarizeThreads(
  review: PullRequestReview | undefined,
  myUserId: string | null,
): ThreadSummary {
  const summary: ThreadSummary = { unresolved: 0, mentionsMe: false, lastCommenter: null };
  if (!review) return summary;

  for (const thread of review.threads) {
    // Only real discussion threads count — system threads (vote/status
    // notifications) carry only system comments.
    const discussion = thread.comments.filter((comment) => !comment.isSystem);
    if (discussion.length === 0) continue;
    if (!thread.isResolved) summary.unresolved += 1;
    for (const comment of discussion) {
      if (contentMentions(comment.content, myUserId)) summary.mentionsMe = true;
      if (comment.author) summary.lastCommenter = comment.author;
    }
  }
  return summary;
}
