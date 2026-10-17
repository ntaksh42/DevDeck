import type { RefObject } from "react";
import type { MentionCandidate } from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import {
  inboxKindClass,
  inboxKindLabel,
  isPullRequestItem,
  isThreadItem,
  isWorkItemItem,
  shortRefName,
  type InboxEntry,
  type InboxLink,
  type InboxTab,
} from "./inboxPresentation";
import {
  ACTION_BUTTON,
  type ReplySeed,
  Kbd,
  ThreadPanel,
  WorkItemPanel,
} from "./InboxPreviewPanels";
import type { InboxDetail } from "./useInboxDetail";
import { InboxInsightPanel } from "./InboxInsightPanel";
import { InboxContextCode, InboxContextDescription, InboxContextSummary } from "./InboxContext";

function bandTitle(item: InboxEntry): string {
  if (isThreadItem(item)) return "Thread";
  if (isWorkItemItem(item)) return item.kind === "wi_mention" ? "Discussion" : "Work item";
  return "Details";
}

export function InboxPreview({
  item,
  tab,
  zoom,
  detail,
  readOnly,
  previewRef,
  mentionSearch,
  resolveImageSource,
  onReply,
  onReplyAndResolve,
  onToggleStatus,
  onComment,
  onResolveAndDone,
  onDone,
  onReopen,
  onSnooze,
  onWake,
  onOpenLink,
  contextExpanded,
  onToggleContext,
  draft,
  onUseDraft,
}: {
  item: InboxEntry | null;
  tab: InboxTab;
  zoom: number;
  detail: InboxDetail;
  readOnly: boolean;
  previewRef: RefObject<HTMLDivElement | null>;
  mentionSearch: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource: (url: string) => Promise<string | null>;
  onReply: (content: string) => Promise<void>;
  onReplyAndResolve: (content: string) => Promise<void>;
  onToggleStatus: () => void;
  onComment: (markdown: string) => Promise<void>;
  onResolveAndDone: () => void;
  onDone: () => void;
  onReopen: () => void;
  onSnooze: (anchor: DOMRect) => void;
  onWake: () => void;
  onOpenLink: (link: InboxLink) => void;
  contextExpanded: boolean;
  onToggleContext: () => void;
  /** Claude's reply draft, once the user asked to use it. */
  draft?: ReplySeed;
  onUseDraft: (text: string) => void;
}) {
  if (!item) {
    return (
      <div ref={previewRef} data-primary-preview="true" tabIndex={-1} className="min-h-0 flex-1 outline-none">
        <PreviewEmptyState message="Nothing needs your response." />
      </div>
    );
  }

  const { review, thread, workItem, links } = detail;
  const heading = isPullRequestItem(item)
    ? `!${item.subjectId} ${review?.title ?? item.title}`
    : isWorkItemItem(item)
      ? `#${item.subjectId} ${workItem?.title ?? item.title}`
      : item.title;
  const branches = review
    ? `${shortRefName(review.sourceRefName)} → ${shortRefName(review.targetRefName)}`
    : null;
  const contextProps = { item, review, thread, workItem };
  const editable =
    !readOnly && !detail.isLoading && ((isThreadItem(item) && !!thread) || (isWorkItemItem(item) && !!workItem));

  return (
    <div
      ref={previewRef}
      data-primary-preview="true"
      data-pane-editable={editable ? "true" : undefined}
      tabIndex={-1}
      style={{ zoom }}
      // A thread's reply box stays pinned to the bottom while its thread is in view.
      // Children keep their height (the clamped heading would otherwise shrink
      // away once a long thread overflows the pane).
      className="flex min-h-0 flex-1 flex-col overflow-y-auto [&>*]:shrink-0 px-3 py-2 outline-none [&_[data-thread-reply-area]]:sticky [&_[data-thread-reply-area]]:bottom-0 [&_[data-thread-reply-area]]:z-10 [&_[data-thread-reply-area]]:bg-card [&_[data-thread-reply-area]]:py-0.5"
    >
      <h2 className="line-clamp-2 text-sm font-semibold leading-snug">{heading}</h2>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className={`font-semibold ${inboxKindClass(item.kind)}`}>{inboxKindLabel(item.kind)}</span>
        <span>
          {item.projectName}
          {item.repositoryName ? ` / ${item.repositoryName}` : ""}
        </span>
        {branches ? <span className="font-mono text-[11px]">{branches}</span> : null}
        <span title={formatDate(item.detectedAt)}>
          {item.author ? `${item.author} · ` : ""}
          {formatRelativeDate(item.detectedAt)}
        </span>
      </div>

      {!detail.isLoading && !detail.error ? <InboxContextSummary {...contextProps} /> : null}
      <InboxInsightPanel insight={item.insight} onUseDraft={onUseDraft} />

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {tab === "open" ? (
          <>
            {isThreadItem(item) && thread && !thread.isResolved && !readOnly ? (
              <button
                type="button"
                className={ACTION_BUTTON}
                disabled={detail.busy}
                onClick={onResolveAndDone}
              >
                Resolve + Done <Kbd>Shift+E</Kbd>
              </button>
            ) : null}
            <button type="button" className={ACTION_BUTTON} onClick={onDone}>
              Done <Kbd>E</Kbd>
            </button>
            <button
              type="button"
              className={ACTION_BUTTON}
              onClick={(event) => onSnooze(event.currentTarget.getBoundingClientRect())}
            >
              Snooze <Kbd>Z</Kbd>
            </button>
          </>
        ) : null}
        {tab === "snoozed" ? (
          <button type="button" className={ACTION_BUTTON} onClick={onWake}>
            Unsnooze <Kbd>Z</Kbd>
          </button>
        ) : null}
        {tab === "done" ? (
          <button type="button" className={ACTION_BUTTON} onClick={onReopen}>
            Reopen <Kbd>E</Kbd>
          </button>
        ) : null}
      </div>

      {!detail.isLoading && !detail.error ? (
        <InboxContextDescription
          {...contextProps}
          expanded={contextExpanded}
          onToggleExpanded={onToggleContext}
          resolveImageSource={resolveImageSource}
        />
      ) : null}

      <h3 className="mt-2 border-b border-border pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {bandTitle(item)}
      </h3>
      {detail.isLoading ? (
        <LoadingState />
      ) : detail.error ? (
        <ErrorState message={detail.error} />
      ) : null}

      {isThreadItem(item) && !detail.isLoading ? (
        <ThreadPanel
          key={item.id}
          item={item}
          thread={thread}
          busy={detail.busy}
          readOnly={readOnly}
          mentionSearch={mentionSearch}
          resolveImageSource={resolveImageSource}
          onReply={onReply}
          onReplyAndResolve={onReplyAndResolve}
          onToggleStatus={onToggleStatus}
          beforeComposer={!detail.error ? <InboxContextCode {...contextProps} /> : null}
          draft={draft}
        />
      ) : null}
      {isWorkItemItem(item) && !detail.isLoading ? (
        <WorkItemPanel
          key={item.id}
          item={item}
          workItem={workItem}
          busy={detail.busy}
          readOnly={readOnly}
          mentionSearch={mentionSearch}
          resolveImageSource={resolveImageSource}
          onComment={onComment}
          draft={draft}
        />
      ) : null}

      {!isThreadItem(item) && !detail.isLoading && !detail.error ? <InboxContextCode {...contextProps} /> : null}

      {links.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-border pt-1.5 text-xs">
          <span className="text-muted-foreground">Links</span>
          {links.slice(0, 9).map((link, index) => (
            <button
              key={link.kind === "external" ? link.url : `${link.kind}-${link.id}`}
              type="button"
              onClick={() => onOpenLink(link)}
              title={link.kind === "external" ? link.url : link.label}
              className="inline-flex items-center gap-1 rounded text-link hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Kbd>{String(index + 1)}</Kbd>
              {link.kind !== "external" ? (
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {link.kind === "workItem" ? "WI" : "PR"}
                </span>
              ) : null}
              {link.label}
              {link.kind === "external" ? <span aria-hidden="true">↗</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
