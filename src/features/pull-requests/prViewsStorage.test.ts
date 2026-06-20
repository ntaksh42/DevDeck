import { beforeEach, describe, expect, it } from "vitest";
import {
  createPullRequestViewsExport,
  loadPullRequestViews,
  normalizePullRequestView,
  parsePullRequestViewsImport,
  savePullRequestViews,
  type PullRequestView,
} from "./prViewsStorage";

const baseView: PullRequestView = {
  id: "pr-view-1",
  name: "My repo, no drafts",
  organizationId: "org-1",
  textFilter: "fix",
  columnFilters: { repositoryName: ["app"], myVote: ["No vote"] },
  showDrafts: false,
  sortKey: "creationDate",
  sortDirection: "desc",
};

describe("normalizePullRequestView", () => {
  it("returns null for non-object or missing id/name", () => {
    expect(normalizePullRequestView(null)).toBeNull();
    expect(normalizePullRequestView({ name: "x" })).toBeNull();
    expect(normalizePullRequestView({ id: "x" })).toBeNull();
  });

  it("keeps valid fields and defaults the rest", () => {
    const view = normalizePullRequestView({ id: "a", name: "b" });
    expect(view).toEqual({
      id: "a",
      name: "b",
      pinned: false,
      organizationId: undefined,
      textFilter: "",
      columnFilters: {},
      showDrafts: false,
      sortKey: "creationDate",
      sortDirection: "desc",
    });
  });

  it("drops unknown columns and non-string filter values", () => {
    const view = normalizePullRequestView({
      ...baseView,
      columnFilters: {
        repositoryName: ["app", 5, "app"],
        bogus: ["x"],
        myVote: [],
      },
    });
    expect(view?.columnFilters).toEqual({ repositoryName: ["app"] });
  });

  it("falls back to defaults for invalid sort key/direction", () => {
    const view = normalizePullRequestView({
      ...baseView,
      sortKey: "nope",
      sortDirection: "sideways",
    });
    expect(view?.sortKey).toBe("creationDate");
    expect(view?.sortDirection).toBe("desc");
  });
});

describe("load/save round-trip", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadPullRequestViews()).toEqual([]);
  });

  it("persists and reloads normalized views", () => {
    savePullRequestViews([baseView]);
    expect(loadPullRequestViews()).toEqual([normalizePullRequestView(baseView)]);
  });

  it("returns an empty list for corrupt JSON", () => {
    window.localStorage.setItem("azdodeck:pullRequestViews", "{not json");
    expect(loadPullRequestViews()).toEqual([]);
  });
});

describe("import/export", () => {
  it("round-trips through the export schema", () => {
    const exported = createPullRequestViewsExport([baseView]);
    const text = JSON.stringify(exported);
    expect(parsePullRequestViewsImport(text)).toEqual([normalizePullRequestView(baseView)]);
  });

  it("accepts a bare array of views", () => {
    const text = JSON.stringify([baseView]);
    expect(parsePullRequestViewsImport(text)).toEqual([normalizePullRequestView(baseView)]);
  });

  it("rejects JSON that is not a view export", () => {
    expect(() => parsePullRequestViewsImport(JSON.stringify({ foo: 1 }))).toThrow(
      /pull request view export/,
    );
  });

  it("rejects an export with no valid views", () => {
    const text = JSON.stringify({
      schema: "azdodeck.pullRequestViews",
      version: 1,
      exportedAt: "now",
      views: [{ nope: true }],
    });
    expect(() => parsePullRequestViewsImport(text)).toThrow(/No valid pull request views/);
  });
});
