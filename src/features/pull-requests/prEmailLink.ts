// Builds the "Email a link" mailto: URL for a pull request, mirroring Azure
// DevOps Web's own share action (subject + body pre-filled with the title and
// URL, no recipient).
export function buildPullRequestEmailLink(pr: {
  pullRequestId: number;
  title: string;
  webUrl: string | null;
}): string {
  const subject = `!${pr.pullRequestId} ${pr.title}`;
  const body = pr.webUrl ? `${pr.title}\n${pr.webUrl}` : pr.title;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
