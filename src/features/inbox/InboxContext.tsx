import type { PrThread, PullRequestReview, WorkItemPreview } from "@/lib/azdoCommands";
import { navigateToWorkItem } from "@/lib/crossLinks";
import { formatRelativeDate } from "@/lib/utils";
import { MarkdownView } from "@/lib/markdown";
import { RichHtmlFrame } from "@/features/work-items/RichHtmlFrame";
import { richFieldHtml } from "@/features/work-items/workItemHtml";
import { InboxCodeSnippet } from "./InboxCodeSnippet";
import { Kbd } from "./InboxPreviewPanels";
import { isThreadItem, type InboxEntry } from "./inboxPresentation";

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

function ExpandToggle({ expanded, onToggle, label }: { expanded: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="rounded px-1 text-[11px] text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {expanded ? "▾" : "▸"} {label} <Kbd>D</Kbd>
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

function WorkItemSummary({ item, workItem }: { item: InboxEntry; workItem: WorkItemPreview }) {
  const parent = workItem.relations.find((relation) => relation.relationType === "Parent");
  // The panel below already shows type, state and assignee; add why and when it last changed.
  const stateLine = [
    workItem.reason ? `Reason: ${workItem.reason}` : null,
    workItem.changedDate ? `changed ${formatRelativeDate(workItem.changedDate)}` : null,
  ].filter(Boolean);
  if (stateLine.length === 0 && !parent) return null;
  return (
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
  );
}

type ContextProps = {
  item: InboxEntry;
  review: PullRequestReview | null;
  thread: PrThread | null;
  workItem: WorkItemPreview | null;
};

/** One line under the heading: who opened the PR and where the votes stand, or a work item's reason and parent. */
export function InboxContextSummary({ item, review, workItem }: ContextProps) {
  if (review) return <PullRequestSummary review={review} />;
  if (workItem) return <WorkItemSummary item={item} workItem={workItem} />;
  return null;
}

/**
 * What the comment is about, shown under the conversation: the code under a
 * line comment and how many other conversations are open.
 */
export function InboxContextCode({ item, review, thread }: ContextProps) {
  if (!review) return null;
  const counts = isThreadItem(item) ? openThreadCounts(review, thread) : null;
  const code = thread?.filePath ? <InboxCodeSnippet key={thread.id} item={item} thread={thread} /> : null;
  if (!code && !(counts && counts.total > 0)) return null;
  return (
    <section aria-label="Context" data-inbox-context="true" className="space-y-1.5 py-1">
      {code}
      {counts && counts.total > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {counts.sameFile > 0 ? `${counts.sameFile} more open in this file · ` : ""}
          {counts.total} open conversation{counts.total === 1 ? "" : "s"} in the PR
        </p>
      ) : null}
    </section>
  );
}

/** The PR description or work item Description, folded until D opens it. */
export function InboxContextDescription({
  item,
  review,
  workItem,
  expanded,
  onToggleExpanded,
  resolveImageSource,
}: ContextProps & {
  expanded: boolean;
  onToggleExpanded: () => void;
  resolveImageSource: (url: string) => Promise<string | null>;
}) {
  const markdown = review ? review.description : null;
  const html = !review && workItem ? richFieldHtml(workItem.descriptionHtml) : null;
  if (!markdown && !html) return null;
  return (
    <section aria-label="Description" data-inbox-description="true" className="mt-1 text-xs">
      <ExpandToggle expanded={expanded} onToggle={onToggleExpanded} label="Description" />
      {expanded && markdown ? (
        <MarkdownView
          text={markdown}
          className="mt-1 break-words"
          baseUrl={item.webUrl}
          resolveImageSource={resolveImageSource}
        />
      ) : null}
      {expanded && html && workItem ? (
        <div className="mt-1">
          <RichHtmlFrame
            baseUrl={workItem.webUrl}
            framed={false}
            html={html}
            resolveImageSource={resolveImageSource}
            title="Description"
          />
        </div>
      ) : null}
    </section>
  );
}
