import { afterEach, describe, expect, it } from "vitest";
import {
  loadRecentPaletteEntries,
  recordRecentPullRequest,
  recordRecentWorkItem,
} from "./recentItems";
import type { PullRequestSummary, WorkItemSummary } from "./azdoCommands";

const WORK_ITEMS_KEY = "azdodeck:workItems:recent";
const PULL_REQUESTS_KEY = "azdodeck:pullRequests:recent";

function workItem(id: number, title: string): WorkItemSummary {
  return {
    organizationId: "contoso",
    projectId: "project-1",
    projectName: "Platform",
    id,
    title,
    workItemType: "Bug",
    state: "Active",
    assignedTo: "Test User",
    changedDate: null,
    webUrl: `https://dev.azure.com/contoso/_workitems/edit/${id}`,
    tags: null,
    extraFields: [],
    depth: null,
  };
}

function pullRequest(id: number, title: string): PullRequestSummary {
  return {
    organizationId: "contoso",
    projectId: "project-1",
    projectName: "Platform",
    repositoryId: "repo-1",
    repositoryName: "core",
    pullRequestId: id,
    title,
    status: "active",
    createdBy: "Test User",
    creationDate: "2026-05-24T00:00:00Z",
    closedDate: null,
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    webUrl: `https://dev.azure.com/contoso/_git/core/pullrequest/${id}`,
    isDraft: false,
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("recordRecentWorkItem / recordRecentPullRequest", () => {
  it("surfaces opened work items and pull requests, newest first", () => {
    recordRecentWorkItem(workItem(1, "Older work item"));
    recordRecentPullRequest(pullRequest(10, "A pull request"));
    recordRecentWorkItem(workItem(2, "Newest work item"));

    const entries = loadRecentPaletteEntries(false);
    expect(entries.map((entry) => entry.label)).toEqual([
      "#2 Newest work item",
      "PR 10 A pull request",
      "#1 Older work item",
    ]);
  });

  it("dedupes a re-opened item to the front without duplicating it", () => {
    recordRecentWorkItem(workItem(1, "First"));
    recordRecentWorkItem(workItem(2, "Second"));
    recordRecentWorkItem(workItem(1, "First"));

    const entries = loadRecentPaletteEntries(false);
    expect(entries.map((entry) => entry.label)).toEqual(["#1 First", "#2 Second"]);
  });

  it("exposes a query that re-opens the item by id", () => {
    recordRecentPullRequest(pullRequest(42, "Fix retries"));
    const [entry] = loadRecentPaletteEntries(false);
    expect(entry.kind).toBe("pullRequests");
    expect(entry.query).toBe("42");
  });
});

describe("loadRecentPaletteEntries resilience", () => {
  it("returns an empty list when storage holds invalid JSON", () => {
    window.localStorage.setItem(WORK_ITEMS_KEY, "{not json");
    window.localStorage.setItem(PULL_REQUESTS_KEY, "also broken");
    expect(loadRecentPaletteEntries(false)).toEqual([]);
  });

  it("skips malformed entries but keeps valid ones", () => {
    window.localStorage.setItem(
      WORK_ITEMS_KEY,
      JSON.stringify([
        { nonsense: true },
        {
          key: "contoso:project-1:7",
          id: 7,
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          title: "Valid",
          viewedAt: "2026-05-24T00:00:00Z",
          webUrl: null,
        },
      ]),
    );
    const entries = loadRecentPaletteEntries(false);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("#7 Valid");
  });
});
