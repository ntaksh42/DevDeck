import { navigateToPullRequest, navigateToWorkItem } from "@/lib/crossLinks";
import { openExternalUrl } from "@/lib/openExternal";
import { isPullRequestItem, isWorkItemItem, type InboxEntry, type InboxLink } from "./inboxPresentation";

/** Shift+Enter: the entry's pull request / work item inside DevDeck (approvals open Pipelines). */
export function openInboxEntryInApp(entry: InboxEntry, onOpenPipelines?: () => void) {
  if (isPullRequestItem(entry)) {
    navigateToPullRequest({
      organizationId: entry.organizationId,
      repositoryId: entry.repositoryId,
      pullRequestId: entry.subjectId,
    });
  } else if (isWorkItemItem(entry)) {
    navigateToWorkItem({ workItemId: entry.subjectId, organizationId: entry.organizationId });
  } else if (entry.kind === "pipeline_approval") {
    onOpenPipelines?.();
  } else if (entry.extra?.agentTarget === "pull-request") {
    navigateToPullRequest({ pullRequestId: entry.subjectId });
  } else if (entry.extra?.agentTarget === "work-item") {
    navigateToWorkItem({ workItemId: entry.subjectId, organizationId: entry.organizationId });
  }
}

export function openInboxEntryInBrowser(entry: InboxEntry) {
  if (entry.webUrl) void openExternalUrl(entry.webUrl);
}

/** 1-9: a numbered link from the comment, resolved in the entry's organization. */
export function openInboxLink(link: InboxLink, organizationId: string) {
  if (link.kind === "workItem") {
    navigateToWorkItem({ workItemId: link.id, organizationId });
  } else if (link.kind === "pullRequest") {
    navigateToPullRequest({ organizationId, pullRequestId: link.id });
  } else {
    void openExternalUrl(link.url);
  }
}
