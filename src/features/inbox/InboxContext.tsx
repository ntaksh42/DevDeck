import { useQuery } from "@tanstack/react-query";
import {
  listPullRequestChanges,
  listPullRequestCommits,
  prLocator,
  type PrThread,
  type PullRequestReview,
  type WorkItemPreview,
} from "@/lib/azdoCommands";
import { navigateToWorkItem } from "@/lib/crossLinks";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { RichHtmlFrame } from "@/features/work-items/RichHtmlFrame";
import { richFieldHtml } from "@/features/work-items/workItemHtml";
import { InboxCodeSnippet } from "./InboxCodeSnippet";
import { Kbd } from "./InboxPreviewPanels";
import { isThreadItem, isVoteItem, type InboxEntry } from "./inboxPresentation";

/** Commits listed for a returned pull request. */
const RETURNED_COMMITS = 5;

/** A thread a person wrote in (not only system notes such as vote changes). */
function isConversation(thread: PrThread): boolean {
  return thread.comments.some((comment) => !comment.isSystem);
}

/** Open conversations elsewhere in the PR: in the same file, and in total. */
export function openThreadCounts(review: PullRequestReview, thread: PrThread | null) {
  const open = review.threads.filter((candidate) => !candidate.isResolved && isConversation(candidate));
  const others = open.filter((candidate) => candidate.id !== thread?.id);
  return {
    sameFile: thread?.filePath ? others.filter((candidate) => candidate.filePath === thread.filePath).length : 0,
    total: open.length,
  };
}

function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="rounded px-1 text-[11px] text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {expanded ? "Less" : "More"} <Kbd>D</Kbd>
    </button>
  );
}

function PullRequestSummary({ review }: { review: PullRequestReview }) {
  const me = review.reviewers.find((reviewer) => reviewer.isMe);
  const requiredWaiting = review.reviewers.filter((reviewer) => reviewer.isRequired && reviewer.vote === 0).length;
  const parts = [
    review.createdBy ? `by ${review.createdBy}` : null,
    review.isDraft ? "Draft" : null,
    me ? `Your vote: ${me.voteLabel}` : null,
    requiredWaiting > 0 ? `${requiredWaiting} required reviewer${requiredWaiting === 1 ? "" : "s"} not voted` : null,
    review.autoComplete ? "Auto-complete on" : null,
  ].filter(Boolean);
  return <p className="text-[11px] text-muted-foreground">{parts.join(" · ")}</p>;
}

function Description({ text, expanded, onToggle }: { text: string; expanded: boolean; onToggle: () => void }) {
  const long = text.split("\n").length > 3 || text.length > 240;
  return (
    <div className="text-xs">
      <p className={`whitespace-pre-line break-words ${expanded ? "" : "line-clamp-3"}`}>{text}</p>
      {long ? <ExpandToggle expanded={expanded} onToggle={onToggle} /> : null}
    </div>
  );
}

/** What was pushed since the user's vote was reset: the newest commits and the file count. */
function ReturnedChanges({ item }: { item: InboxEntry }) {
  const locator = prLocator({
    organizationId: item.organizationId,
    projectId: item.projectId,
    repositoryId: item.repositoryId,
    pullRequestId: item.subjectId,
  });
  const commitsQuery = useQuery({
    queryKey: ["prCommits", item.organizationId, item.repositoryId, item.subjectId],
    queryFn: () => listPullRequestCommits(locator),
    staleTime: 60_000,
  });
  const changesQuery = useQuery({
    queryKey: ["pullRequestChanges", item.organizationId, item.repositoryId, item.subjectId],
    queryFn: () => listPullRequestChanges(locator),
    staleTime: 5 * 60_000,
  });
  const commits = commitsQuery.data?.slice(0, RETURNED_COMMITS) ?? [];
  const fileCount = changesQuery.data?.files.length;
  if (commits.length === 0 && fileCount === undefined) return null;
  return (
    <div className="text-xs">
      <p className="text-[11px] text-muted-foreground">
        Latest commits{fileCount !== undefined ? ` · ${fileCount} changed file${fileCount === 1 ? "" : "s"} in the PR` : ""}
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {commits.map((commit) => (
          <li key={commit.commitId} className="flex min-w-0 gap-2">
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{commit.shortCommitId}</span>
            <span className="min-w-0 flex-1 truncate" title={commit.comment}>
              {commit.comment.split("\n")[0]}
            </span>
            {commit.authorDate ? (
              <span className="shrink-0 text-[11px] text-muted-foreground" title={formatDate(commit.authorDate)}>
                {formatRelativeDate(commit.authorDate)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkItemContext({
  item,
  workItem,
  expanded,
  onToggle,
  resolveImageSource,
}: {
  item: InboxEntry;
  workItem: WorkItemPreview;
  expanded: boolean;
  onToggle: () => void;
  resolveImageSource: (url: string) => Promise<string | null>;
}) {
  const parent = workItem.relations.find((relation) => relation.relationType === "Parent");
  const description = richFieldHtml(workItem.descriptionHtml);
  // The panel below already shows type, state and assignee; add why and when it last changed.
  const stateLine = [
    workItem.reason ? `Reason: ${workItem.reason}` : null,
    workItem.changedDate ? `changed ${formatRelativeDate(workItem.changedDate)}` : null,
  ].filter(Boolean);
  return (
    <>
      {stateLine.length > 0 || parent ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {stateLine.length > 0 ? <span>{stateLine.join(" · ")}</span> : null}
          {parent ? (
            <button
              type="button"
              onClick={() => navigateToWorkItem({ workItemId: parent.id, organizationId: item.organizationId })}
              className="min-w-0 truncate rounded text-left hover:underline focus:outline-none focus:ring-1 focus:ring-ring"
              title={`Open parent #${parent.id} in DevDeck`}
            >
              Parent: #{parent.id} {parent.title ?? ""}
            </button>
          ) : null}
        </div>
      ) : null}
      {description ? (
        <div className="text-xs">
          <div className={expanded ? "" : "max-h-24 overflow-hidden"}>
            <RichHtmlFrame
              baseUrl={workItem.webUrl}
              framed={false}
              html={description}
              resolveImageSource={resolveImageSource}
              title="Description"
            />
          </div>
          <ExpandToggle expanded={expanded} onToggle={onToggle} />
        </div>
      ) : null}
    </>
  );
}

/**
 * What the item is about, so the user can decide without opening the browser:
 * for a PR comment, the PR's summary and description, the code under the
 * comment and how many other conversations are open; for a returned PR, what
 * was pushed; for a work item, its description and parent.
 */
export function InboxContext({
  item,
  review,
  thread,
  workItem,
  expanded,
  onToggleExpanded,
  resolveImageSource,
}: {
  item: InboxEntry;
  review: PullRequestReview | null;
  thread: PrThread | null;
  workItem: WorkItemPreview | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  resolveImageSource: (url: string) => Promise<string | null>;
}) {
  if (review) {
    const counts = isThreadItem(item) ? openThreadCounts(review, thread) : null;
    return (
      <section aria-label="Context" data-inbox-context="true" className="space-y-1.5 py-1">
        <PullRequestSummary review={review} />
        {/* A vote item's panel already shows the description. */}
        {review.description && !isVoteItem(item) ? (
          <Description text={review.description} expanded={expanded} onToggle={onToggleExpanded} />
        ) : null}
        {thread?.filePath ? <InboxCodeSnippet key={thread.id} item={item} thread={thread} /> : null}
        {counts && counts.total > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {counts.sameFile > 0 ? `${counts.sameFile} more open in this file · ` : ""}
            {counts.total} open conversation{counts.total === 1 ? "" : "s"} in the PR
          </p>
        ) : null}
        {isVoteItem(item) ? <ReturnedChanges item={item} /> : null}
      </section>
    );
  }
  if (workItem) {
    return (
      <section aria-label="Context" data-inbox-context="true" className="space-y-1.5 py-1">
        <WorkItemContext
          item={item}
          workItem={workItem}
          expanded={expanded}
          onToggle={onToggleExpanded}
          resolveImageSource={resolveImageSource}
        />
      </section>
    );
  }
  return null;
}
