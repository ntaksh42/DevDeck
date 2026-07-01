import { describe, expect, it } from "vitest";
import { prLabelOptions } from "./PrSearchTypes";
import type { PullRequestSummary } from "@/lib/azdoCommands";

function pr(labels: string[]): PullRequestSummary {
  return {
    organizationId: "contoso",
    projectId: "project-1",
    projectName: "Platform",
    repositoryId: "repo-1",
    repositoryName: "core",
    pullRequestId: 1,
    title: "Test",
    status: "active",
    createdBy: null,
    creationDate: "2026-06-01T00:00:00Z",
    closedDate: null,
    sourceRefName: "refs/heads/feature",
    targetRefName: "refs/heads/main",
    webUrl: null,
    isDraft: false,
    labels,
  };
}

describe("prLabelOptions", () => {
  it("returns unique, case-insensitively sorted label names across results", () => {
    const results = [pr(["hotfix", "needs-review"]), pr(["Bug"]), pr(["hotfix"]), pr([])];
    expect(prLabelOptions(results)).toEqual(["Bug", "hotfix", "needs-review"]);
  });

  it("returns an empty list when no result has labels", () => {
    expect(prLabelOptions([pr([]), pr([])])).toEqual([]);
  });
});
