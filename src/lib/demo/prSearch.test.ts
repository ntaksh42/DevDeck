import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchPullRequestsInput, PullRequestSummary } from "../commands/prs";
import { demoProgressivePrSearch, matchesDemoPrPeople, stopDemoPrSearch } from "./prSearch";
import { demoPullRequests } from "./prData";

let sequence = 0;
let input: SearchPullRequestsInput;
const samples = (): PullRequestSummary[] => Array.from({ length: 230 }, (_, i) => ({
  organizationId: "contoso", projectId: i % 2 ? "mobile" : "platform", projectName: "Platform",
  repositoryId: "r", repositoryName: "portal", pullRequestId: i + 1,
  title: `Fix login timeout ${i}`, status: "active", createdBy: "Demo User",
  creationDate: "2026-01-01T00:00:00Z", closedDate: null,
  sourceRefName: "fix/login", targetRefName: "main", webUrl: null, isDraft: false,
}));
beforeEach(() => {
  input = { progressive: true, searchId: `test-${sequence++}`, organizationId: "contoso", query: "login timeout" };
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

describe("progressive browser demo contract", () => {
  it("returns non-overlapping deltas beyond 100 and reports true completion", () => {
    const first = demoProgressivePrSearch(input, samples());
    expect(first.pullRequests).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect(first.searchComplete).toBe(false);
    const second = demoProgressivePrSearch({ ...input, continuationToken: first.continuationToken! }, []);
    const third = demoProgressivePrSearch({ ...input, continuationToken: second.continuationToken! }, []);
    expect(third.total).toBe(230);
    expect(third.hasMore).toBe(false);
    expect(third.searchComplete).toBe(true);
    expect(third.continuationToken).toBeNull();
    expect(new Set([...first.pullRequests, ...second.pullRequests, ...third.pullRequests].map((p) => p.pullRequestId)).size).toBe(230);
  });
  it("distinguishes zero matches with more to search from a completed empty search", () => {
    window.history.replaceState({}, "", "/?prSearchScenario=empty-first");
    const first = demoProgressivePrSearch(input, samples());
    expect(first.pullRequests).toEqual([]);
    expect(first.scannedCount).toBe(2000);
    expect(first.hasMore).toBe(true);
    const next = demoProgressivePrSearch({ ...input, continuationToken: first.continuationToken! }, []);
    expect(next.pullRequests).toHaveLength(100);
    const empty = demoProgressivePrSearch({ ...input, searchId: "empty-final", query: "missing" }, samples());
    const final = demoProgressivePrSearch({ ...input, searchId: "empty-final", query: "missing", continuationToken: empty.continuationToken! }, []);
    expect(final.searchComplete).toBe(true);
    expect(final.total).toBe(0);
  });
  it("retains failed scope rows for an explicit retry", () => {
    window.history.replaceState({}, "", "/?prSearchScenario=partial");
    const first = demoProgressivePrSearch(input, samples().slice(0, 8));
    expect(first.failedScopes).toEqual(["Mobile"]);
    expect(first.searchComplete).toBe(false);
    expect(first.hasMore).toBe(false);
    const next = demoProgressivePrSearch({ ...input, continuationToken: first.continuationToken!, retryFailed: true }, []);
    expect(next.pullRequests.map((p) => p.projectId)).toEqual(["mobile", "mobile", "mobile", "mobile"]);
    expect(next.total).toBe(8);
    expect(next.searchComplete).toBe(true);
  });
  it("binds continuation to organization, search ID and conditions", () => {
    const first = demoProgressivePrSearch(input, samples());
    for (const change of [{ organizationId: "other" }, { query: "another" }, { authorId: "me" }, { searchId: "other" }]) {
      expect(() => demoProgressivePrSearch({ ...input, ...change, continuationToken: first.continuationToken! }, [])).toThrow();
    }
    demoProgressivePrSearch({ ...input, continuationToken: first.continuationToken! }, []);
    expect(() => demoProgressivePrSearch({ ...input, continuationToken: first.continuationToken! }, [])).toThrow();
  });
  it("expires idle sessions and preserves stopped progress for resumption", () => {
    stopDemoPrSearch({ searchId: input.searchId!, organizationId: "contoso" });
    const stopped = demoProgressivePrSearch(input, samples());
    expect(stopped.pullRequests).toEqual([]);
    expect(stopped.hasMore).toBe(true);
    const resumed = demoProgressivePrSearch({ ...input, continuationToken: stopped.continuationToken! }, []);
    expect(resumed.pullRequests).toHaveLength(100);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_001);
    expect(() => demoProgressivePrSearch({ ...input, continuationToken: resumed.continuationToken! }, [])).toThrow(/expired/);
  });
  it("uses the same AND/exclusion rules and resolves individual identity filters", () => {
    expect(demoPullRequests({ ...input, statuses: ["active", "completed"], query: "pull dashboard -offline", authorId: "me" }).pullRequests.map((p) => p.pullRequestId)).toEqual([42]);
    expect(matchesDemoPrPeople({ reviewerId: "me" }, samples()[0])).toBe(true);
    expect(matchesDemoPrPeople({ authorId: "demo-frank" }, samples()[0])).toBe(false);
    expect(() => demoProgressivePrSearch({ ...input, query: '"open' }, samples())).toThrow(/quotation/);
  });
});
