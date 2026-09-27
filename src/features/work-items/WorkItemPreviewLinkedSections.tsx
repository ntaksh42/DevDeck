import type { WorkItemPreview } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { PreviewSection } from "./PreviewSection";
import { WorkItemStatePill } from "./WorkItemBadges";

// Pull Requests and Attachments sections of the work item preview, split out
// of WorkItemPreviewDetails.tsx to keep that file under the 500-line limit.

export function WorkItemPullRequestsSection({ preview }: { preview: WorkItemPreview }) {
  return (
    <PreviewSection
      accentColor="border-l-violet-400 dark:border-l-violet-500"
      collapseId="pullRequests"
      title={`Pull Requests (${preview.pullRequests.length})`}
    >
      <div className="space-y-1">
        {preview.pullRequests.map((pr) => {
          const inReviews = !!pr.repositoryId;
          return (
            <button
              key={pr.pullRequestId}
              type="button"
              onClick={() => {
                if (pr.webUrl) openExternalUrl(pr.webUrl);
              }}
              disabled={!pr.webUrl}
              className="flex w-full min-w-0 items-center gap-1.5 rounded border border-border bg-card px-1.5 py-1 text-left text-xs hover:bg-secondary disabled:cursor-default disabled:opacity-60"
              title={pr.webUrl ?? "Pull request not in My Reviews"}
            >
              <span className="w-16 shrink-0 truncate text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {inReviews ? "Review" : "PR"}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-extrabold text-primary">
                !{pr.pullRequestId}
              </span>
              <span className="min-w-0 flex-1 truncate">{pr.title ?? "(not in My Reviews)"}</span>
              {pr.myVoteLabel ? (
                <span className="shrink-0 rounded border border-border bg-muted px-1 py-px text-[11px] text-muted-foreground">
                  {pr.myVoteLabel}
                </span>
              ) : null}
              {pr.status ? <WorkItemStatePill state={pr.status} /> : null}
            </button>
          );
        })}
      </div>
    </PreviewSection>
  );
}

export function WorkItemAttachmentsSection({ preview }: { preview: WorkItemPreview }) {
  return (
    <PreviewSection
      accentColor="border-l-amber-400 dark:border-l-amber-500"
      collapseId="attachments"
      title={`Attachments (${preview.attachments.length})`}
    >
      <div className="space-y-1">
        {preview.attachments.map((attachment) => (
          <button
            key={attachment.url}
            type="button"
            onClick={() => openExternalUrl(attachment.url)}
            title={`Download ${attachment.name}`}
            aria-label={`Download attachment ${attachment.name}`}
            className="flex w-full min-w-0 items-center gap-1.5 rounded border border-border bg-card px-1.5 py-1 text-left text-xs hover:bg-secondary"
          >
            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
            <span className="shrink-0 text-[11px] text-primary">Download</span>
          </button>
        ))}
      </div>
    </PreviewSection>
  );
}
