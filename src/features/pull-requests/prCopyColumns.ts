import type {
  MyCreatedPullRequestSummary,
  PullRequestSummary,
  ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import type { CopyColumn } from "@/lib/clipboardTable";
import { formatDate } from "@/lib/utils";
import { reviewAgeDays } from "./myReviewsHelpers";
import { sortLabels as reviewLabels, type SortKey as ReviewKey } from "./myReviewsTypes";
import { sortLabels as createdLabels, type SortKey as CreatedKey } from "./myPullRequestsTypes";
import { PR_SEARCH_COLUMN_LABELS, type PrSearchColumnKey } from "./PrSearchTypes";

// ID and title cells carry the PR link, like the grid's own ID button.
const LINKED_KEYS = ["pullRequestId", "title"];

function draftPrefix(pr: { isDraft?: boolean }): string {
  return pr.isDraft ? "[Draft] " : "";
}

function ciLabel(pr: ReviewPullRequestSummary): string {
  switch (pr.ciStatus) {
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "in_progress":
      return "In progress";
    default:
      return "Not run";
  }
}

function reviewCellText(pr: ReviewPullRequestSummary, key: ReviewKey): string {
  switch (key) {
    case "pullRequestId":
      return `#${pr.pullRequestId}`;
    case "ciStatus":
      return ciLabel(pr);
    case "repositoryName":
      return pr.repositoryName;
    case "title":
      return `${draftPrefix(pr)}${pr.title}`;
    case "createdBy":
      return pr.createdBy ?? "Unknown";
    case "creationDate":
      return formatDate(pr.creationDate);
    case "reviewAge": {
      const days = reviewAgeDays(pr.creationDate);
      return days === null ? "" : `${days}d`;
    }
    case "targetRefName":
      return pr.targetRefName;
    case "myIsRequired":
      return pr.myIsRequired ? "Required" : "Optional";
    case "myVote":
      return pr.myVoteLabel;
  }
}

export function reviewCopyColumns(visible: ReviewKey[]): CopyColumn<ReviewPullRequestSummary>[] {
  return visible.map((key) => ({
    label: reviewLabels[key],
    text: (pr) => reviewCellText(pr, key),
    href: LINKED_KEYS.includes(key) ? (pr) => pr.webUrl : undefined,
  }));
}

function createdCellText(pr: MyCreatedPullRequestSummary, key: CreatedKey): string {
  switch (key) {
    case "pullRequestId":
      return `#${pr.pullRequestId}`;
    case "repositoryName":
      return pr.repositoryName;
    case "title":
      return `${draftPrefix(pr)}${pr.title}`;
    case "creationDate":
      return formatDate(pr.creationDate);
    case "targetRefName":
      return pr.targetRefName;
    case "approvals":
      return `${pr.approvals}/${pr.reviewerCount}`;
  }
}

export function createdCopyColumns(visible: CreatedKey[]): CopyColumn<MyCreatedPullRequestSummary>[] {
  return visible.map((key) => ({
    label: createdLabels[key],
    text: (pr) => createdCellText(pr, key),
    href: LINKED_KEYS.includes(key) ? (pr) => pr.webUrl : undefined,
  }));
}

function searchCellText(pr: PullRequestSummary, key: PrSearchColumnKey): string {
  switch (key) {
    case "pullRequestId":
      return `#${pr.pullRequestId}`;
    case "status":
      return pr.status;
    case "title":
      return pr.title;
    case "repository":
      return `${pr.projectName} / ${pr.repositoryName}`;
    case "author":
      return pr.createdBy ?? "Unknown";
    case "date":
      return formatDate(pr.creationDate);
    case "branch":
      return `${pr.sourceRefName} → ${pr.targetRefName}`;
  }
}

export function prSearchCopyColumns(visible: PrSearchColumnKey[]): CopyColumn<PullRequestSummary>[] {
  return visible.map((key) => ({
    label: PR_SEARCH_COLUMN_LABELS[key],
    text: (pr) => searchCellText(pr, key),
    href: LINKED_KEYS.includes(key) ? (pr) => pr.webUrl : undefined,
  }));
}
