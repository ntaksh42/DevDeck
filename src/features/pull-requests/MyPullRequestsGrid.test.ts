import { describe, expect, it } from "vitest";
import type { MyPullRequestSummary } from "@/lib/azdoCommands";
import { listMyPullRequests } from "@/lib/azdoCommands";
import { sectionOf } from "./MyPullRequestsGrid";

function pr(overrides: Partial<MyPullRequestSummary>): MyPullRequestSummary {
  return {
    organizationId: "contoso",
    projectId: "p",
    projectName: "P",
    repositoryId: "r",
    repositoryName: "R",
    pullRequestId: 1,
    title: "PR",
    creationDate: "2026-06-01T00:00:00Z",
    sourceRefName: "feature/x",
    targetRefName: "main",
    webUrl: null,
    isDraft: false,
    mergeStatus: null,
    approvals: 0,
    waiting: 0,
    rejections: 0,
    noVote: 0,
    changesRequested: false,
    ...overrides,
  };
}

describe("sectionOf", () => {
  it("classifies drafts first, regardless of votes", () => {
    expect(sectionOf(pr({ isDraft: true, changesRequested: true }))).toBe("draft");
  });

  it("classifies changes-requested PRs", () => {
    expect(sectionOf(pr({ changesRequested: true, rejections: 1 }))).toBe("changesRequested");
  });

  it("classifies approved PRs with no changes requested", () => {
    expect(sectionOf(pr({ approvals: 2 }))).toBe("approved");
  });

  it("falls back to awaiting review", () => {
    expect(sectionOf(pr({ noVote: 1 }))).toBe("awaiting");
  });
});

describe("listMyPullRequests (demo runtime)", () => {
  it("returns demo PRs spanning the sections", async () => {
    const prs = await listMyPullRequests({ organizationId: "contoso" });
    expect(prs.length).toBeGreaterThan(0);
    const sections = new Set(prs.map(sectionOf));
    expect(sections.has("changesRequested")).toBe(true);
    expect(sections.has("approved")).toBe(true);
    expect(sections.has("draft")).toBe(true);
  });
});
