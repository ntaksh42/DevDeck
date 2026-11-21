import type { PullRequestSearchResult, PullRequestSummary, SearchPullRequestsInput } from "../commands/prs";
import { matchesPrSearchQuery, parsePrSearchQuery } from "../prSearchQuery";

type Session = {
  searchId: string;
  org: string;
  signature: string;
  token: string;
  rows: PullRequestSummary[];
  failedRows: PullRequestSummary[];
  offset: number;
  scanned: number;
  returned: number;
  touched: number;
  emptyFirst: boolean;
  failed: boolean;
};
const sessions = new Map<string, Session>();
const stopped = new Set<string>();
let nextToken = 0;
const signature = (input: SearchPullRequestsInput) => JSON.stringify([
  input.query ?? "", input.statuses ?? [], input.projectIds ?? [], input.repositoryIds ?? [],
  input.targetBranches ?? [], input.fromDate ?? "", input.toDate ?? "", input.dateBasis ?? "created",
  input.excludeDrafts ?? false, input.authorId ?? "", input.reviewerId ?? "", input.excludeWords ?? "",
]);
const keyFor = (org: string, id: string) => `${org}:${id}`;

export function stopDemoPrSearch(input: { organizationId?: string; searchId: string }): void {
  stopped.add(keyFor(input.organizationId ?? "contoso", input.searchId));
}

export function matchesDemoPrPeople(input: SearchPullRequestsInput, pr: PullRequestSummary): boolean {
  const identity = (id?: string) => id === "me" ? "demo-user" : id;
  const authors: Record<string, string> = {
    "Demo User": "demo-user", "Grace Chen": "demo-grace", "Frank Lee": "demo-frank",
    "Heidi Park": "demo-heidi", "Carol Wang": "demo-carol", "Eve Nakamura": "demo-eve",
  };
  if (input.authorId && authors[pr.createdBy ?? ""] !== identity(input.authorId)) return false;
  // Demo User is registered on each sample; Alice and Bob alternate by PR.
  return !input.reviewerId || ["demo-user", pr.pullRequestId % 2 ? "demo-alice" : "demo-bob"]
    .includes(identity(input.reviewerId)!);
}

export function demoProgressivePrSearch(
  input: SearchPullRequestsInput,
  candidates: PullRequestSummary[],
): PullRequestSearchResult {
  const org = input.organizationId ?? "contoso";
  const searchId = input.searchId;
  if (!searchId) throw new Error("A search ID is required.");
  const terms = parsePrSearchQuery(input.query ?? "", input.excludeWords);
  const now = Date.now();
  for (const [key, old] of sessions) if (now - old.touched >= 600_000) {
    sessions.delete(key);
    stopped.delete(key);
  }
  const key = keyFor(org, searchId);
  let session: Session;
  if (input.continuationToken) {
    const stored = sessions.get(key);
    if (!stored || input.continuationToken !== stored.token || stored.signature !== signature(input)) {
      throw new Error("This search has expired or its conditions changed. Run Search again.");
    }
    session = stored;
    stopped.delete(key);
  } else {
    const scenario = typeof window === "undefined" ? null :
      new URLSearchParams(window.location.search).get("prSearchScenario");
    const rows = org === "contoso" ? candidates : [];
    session = {
      org, searchId, signature: signature(input), token: "", rows, failedRows: [],
      offset: 0, scanned: 0, returned: 0, touched: now,
      emptyFirst: scenario === "empty-first", failed: scenario === "partial",
    };
    if (session.failed) {
      session.failedRows = rows.filter((pr) => pr.projectId === "mobile");
      session.rows = rows.filter((pr) => pr.projectId !== "mobile");
    }
    sessions.set(key, session);
  }
  if (input.retryFailed && session.failed) {
    session.rows.push(...session.failedRows);
    session.failedRows = [];
    session.failed = false;
  }
  const pullRequests: PullRequestSummary[] = [];
  if (session.emptyFirst && !stopped.has(key)) {
    // Dedicated harness fixture: one full scan budget precedes the sample hits.
    session.emptyFirst = false;
    session.scanned += 2_000;
  } else {
    let checked = 0;
    while (!stopped.has(key) && session.offset < session.rows.length && checked < 2_000 && pullRequests.length < 100) {
      const pr = session.rows[session.offset++];
      session.scanned++;
      checked++;
      if (matchesPrSearchQuery(terms, pr)) pullRequests.push(pr);
    }
  }
  session.returned += pullRequests.length;
  session.touched = now;
  const hasMore = session.emptyFirst || session.offset < session.rows.length;
  const complete = !hasMore && !session.failed;
  session.token = `demo-pr-search-${++nextToken}`;
  return {
    pullRequests, total: session.returned, truncated: hasMore, warnings: session.failed ? ["Mobile"] : [],
    searchId, continuationToken: complete ? null : session.token, scannedCount: session.scanned,
    hasMore, searchComplete: complete, failedScopes: session.failed ? ["Mobile"] : [],
  };
}
