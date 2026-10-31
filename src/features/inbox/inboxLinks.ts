import type { PrThread, PullRequestReview, WorkItemPreview } from "@/lib/azdoCommands";
import { extractWorkItemMentions } from "@/lib/crossLinks";
import {
  extractInboxLinks,
  isPullRequestItem,
  isWorkItemItem,
  shortUrlLabel,
  type InboxEntry,
  type InboxLink,
  type InboxLinkOrigin,
} from "./inboxPresentation";

/** Group order in the preview; the numbered keys follow it. */
export const INBOX_LINK_ORIGINS: { origin: InboxLinkOrigin; label: string }[] = [
  { origin: "linked", label: "Linked" },
  { origin: "description", label: "Description" },
  { origin: "comment", label: "Comments" },
  { origin: "attachment", label: "Attachments" },
];

/** A work item linked to a pull request, with what is known about it. */
export type LinkedWorkItem = { id: number; title: string | null; state: string | null };

function linkKey(link: InboxLink): string {
  return link.kind === "external" ? link.url : `${link.kind}:${link.id}`;
}

/**
 * Joins link lists into one without duplicates and orders it by origin (the
 * order of {@link INBOX_LINK_ORIGINS}). When a link appears twice the first
 * one wins, so pass the lists that know titles first.
 */
export function mergeInboxLinks(...groups: InboxLink[][]): InboxLink[] {
  const seen = new Set<string>();
  const merged: InboxLink[] = [];
  for (const link of groups.flat()) {
    const key = linkKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(link);
  }
  const rank = (link: InboxLink) => INBOX_LINK_ORIGINS.findIndex((group) => group.origin === link.origin);
  return merged
    .map((link, index) => ({ link, index }))
    .sort((a, b) => rank(a.link) - rank(b.link) || a.index - b.index)
    .map(({ link }) => link);
}

/** The text of a rich-text (HTML) field plus the targets of its anchors, so link URLs are found, not just the visible words. */
export function richTextSources(html: string | null | undefined): string[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const hrefs = Array.from(doc.querySelectorAll("a[href]"), (anchor) => anchor.getAttribute("href"));
  return [doc.body.textContent, ...hrefs].filter((text): text is string => !!text);
}

function workItemLink(id: number, origin: InboxLinkOrigin, title: string | null, detail: string | null): InboxLink {
  return { kind: "workItem", id, label: `#${id}`, origin, title, detail };
}

function linkedWorkItemLinks(linked: LinkedWorkItem[]): InboxLink[] {
  return linked.map((workItem) => workItemLink(workItem.id, "linked", workItem.title, workItem.state));
}

/** Ids of the work items a pull request is tied to: the Development links and `AB#n` in its description. */
export function pullRequestWorkItemIds(linkedIds: number[], description: string | null | undefined): number[] {
  return [...new Set([...linkedIds, ...extractWorkItemMentions([description])])].sort((a, b) => a - b);
}

/**
 * Everything a reply to a pull request comment may need to follow up on: the
 * linked work items, then the links in the description and in the thread.
 */
export function pullRequestInboxLinks(
  item: InboxEntry,
  review: PullRequestReview | null,
  thread: PrThread | null,
  linked: LinkedWorkItem[],
): InboxLink[] {
  const comments = thread
    ? thread.comments.filter((comment) => !comment.isSystem).map((comment) => comment.content)
    : [item.snippet];
  return withoutSelf(
    item,
    mergeInboxLinks(
      linkedWorkItemLinks(linked),
      extractInboxLinks([review?.description], "description"),
      extractInboxLinks(comments, "comment"),
    ),
  );
}

/**
 * Everything a reply to a work item mention may need to follow up on: parent /
 * child / related items and pull requests, then the links in the Description,
 * the mention itself, the other comments and the attachments.
 */
export function workItemInboxLinks(item: InboxEntry, workItem: WorkItemPreview | null): InboxLink[] {
  if (!workItem) return withoutSelf(item, extractInboxLinks([item.snippet], "comment"));
  const relations = workItem.relations.map((relation) =>
    workItemLink(
      relation.id,
      "linked",
      relation.title,
      [relation.relationType, relation.state].filter(Boolean).join(" · ") || null,
    ),
  );
  const pullRequests = workItem.pullRequests.map(
    (pullRequest): InboxLink => ({
      kind: "pullRequest",
      id: pullRequest.pullRequestId,
      repositoryId: pullRequest.repositoryId,
      label: `!${pullRequest.pullRequestId}`,
      origin: "linked",
      title: pullRequest.title,
      detail: [pullRequest.status, pullRequest.myVoteLabel && `You: ${pullRequest.myVoteLabel}`]
        .filter(Boolean)
        .join(" · ") || null,
    }),
  );
  // The comment that mentioned the user comes first so its links get the low numbers.
  const mention = workItem.comments.find((comment) => comment.id === item.commentId);
  const others = workItem.comments.filter((comment) => comment !== mention);
  const commentSources = [...(mention ? [mention] : []), ...others].flatMap((comment) =>
    richTextSources(comment.renderedText ?? comment.text),
  );
  const attachments = workItem.attachments.map(
    (attachment): InboxLink => ({
      kind: "external",
      url: attachment.url,
      label: attachment.name || shortUrlLabel(attachment.url),
      origin: "attachment",
    }),
  );
  return withoutSelf(
    item,
    mergeInboxLinks(
      relations,
      pullRequests,
      extractInboxLinks(richTextSources(workItem.descriptionHtml), "description"),
      extractInboxLinks(commentSources.length > 0 ? commentSources : [item.snippet], "comment"),
      attachments,
    ),
  );
}

/** The entry's own pull request / work item (and its URL) is what the preview is about, not a related link. */
function withoutSelf(item: InboxEntry, links: InboxLink[]): InboxLink[] {
  return links.filter((link) => {
    if (link.kind === "external") return link.url !== item.webUrl;
    if (link.kind === "workItem") return !(isWorkItemItem(item) && link.id === item.subjectId);
    return !(isPullRequestItem(item) && link.id === item.subjectId);
  });
}
