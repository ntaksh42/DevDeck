import type { SearchAllInput, SearchAllResult } from "@/lib/azdoCommands";
import { demoPullRequests, demoReviewPullRequests, demoPrReviewDetail } from "./prData";
import { demoWorkItems } from "./workItems";

export function demoPaletteSearch(input?: SearchAllInput): SearchAllResult {
  const query = input?.query.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(input?.limitPerKind ?? 5, 50));
  if (!query) return { workItems: [], pullRequests: [], totals: { workItems: 0, pullRequests: 0 }, warnings: [] };
  const matches = (org: string, id: number, title: string) =>
    (!input?.organizationId || org === input.organizationId) &&
    (/^\d+$/.test(query) ? Number(query) === id : title.toLowerCase().includes(query));
  const workItems = (input?.kind === "pullRequests" ? [] : demoWorkItems()).filter((wi) => matches(wi.organizationId, wi.id, wi.title));
  const allPrs = demoPullRequests({ statuses: ["active", "completed", "abandoned"] }).pullRequests;
  const pullRequests = allPrs.filter((pr) => pr.status === "active");
  // Include active review-cache PRs, as the desktop's shared PR cache does.
  for (const pr of demoReviewPullRequests()) {
    if (!allPrs.some((row) => row.repositoryId === pr.repositoryId && row.pullRequestId === pr.pullRequestId)) {
      pullRequests.push({ ...pr, status: "active", closedDate: null,
        sourceRefName: demoPrReviewDetail(pr.pullRequestId).sourceRefName });
    }
  }
  const matchedPrs = (input?.kind === "workItems" ? [] : pullRequests).filter((pr) => matches(pr.organizationId, pr.pullRequestId, pr.title));
  workItems.sort((a, b) => Number(String(b.id) === query) - Number(String(a.id) === query) ||
    Date.parse(b.changedDate ?? "1970-01-01") - Date.parse(a.changedDate ?? "1970-01-01"));
  matchedPrs.sort((a, b) => Number(String(b.pullRequestId) === query) - Number(String(a.pullRequestId) === query) ||
    Date.parse(b.creationDate) - Date.parse(a.creationDate));
  return { workItems: workItems.slice(0, limit), pullRequests: matchedPrs.slice(0, limit),
    warnings: [], totals: { workItems: workItems.length, pullRequests: matchedPrs.length } };
}
