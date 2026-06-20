import { describe, expect, it } from "vitest";
import {
  matchesWorkItemQuery,
  parseSearchQuery,
  singleIdJump,
  type WorkItemMatchTarget,
} from "./searchQuery";

function item(overrides: Partial<WorkItemMatchTarget> = {}): WorkItemMatchTarget {
  return {
    id: 1234,
    title: "Fix login bug",
    workItemType: "Bug",
    state: "Active",
    assignedTo: "Akira Nao",
    projectName: "Demo Project",
    priority: 1,
    tags: [],
    ...overrides,
  };
}

describe("parseSearchQuery", () => {
  it("returns empty filters and text for blank input", () => {
    expect(parseSearchQuery("")).toEqual({ filters: [], text: [] });
    expect(parseSearchQuery("   ")).toEqual({ filters: [], text: [] });
  });

  it("parses #id as an id filter", () => {
    expect(parseSearchQuery("#1234")).toEqual({
      filters: [{ key: "id", value: "1234" }],
      text: [],
    });
  });

  it("parses @user as an assignee filter", () => {
    expect(parseSearchQuery("@aksh0")).toEqual({
      filters: [{ key: "assignee", value: "aksh0" }],
      text: [],
    });
  });

  it("parses p:/s:/t: prefixes into their keys", () => {
    expect(parseSearchQuery("p:1").filters).toEqual([{ key: "priority", value: "1" }]);
    expect(parseSearchQuery("s:active").filters).toEqual([{ key: "state", value: "active" }]);
    expect(parseSearchQuery("t:bug").filters).toEqual([{ key: "type", value: "bug" }]);
    expect(parseSearchQuery("sha:abcd1234").filters).toEqual([
      { key: "sha", value: "abcd1234" },
    ]);
  });

  it("combines multiple prefixes and keeps free text", () => {
    const parsed = parseSearchQuery("p:1 s:active @aksh0 login");
    expect(parsed.filters).toEqual([
      { key: "priority", value: "1" },
      { key: "state", value: "active" },
      { key: "assignee", value: "aksh0" },
    ]);
    expect(parsed.text).toEqual(["login"]);
  });

  it("treats unknown prefixes as plain text", () => {
    expect(parseSearchQuery("foo:bar")).toEqual({ filters: [], text: ["foo:bar"] });
  });

  it("treats a bare # or @ as plain text", () => {
    expect(parseSearchQuery("# @").text).toEqual(["#", "@"]);
  });
});

describe("matchesWorkItemQuery", () => {
  it("matches everything for an empty query", () => {
    expect(matchesWorkItemQuery(item(), parseSearchQuery(""))).toBe(true);
  });

  it("matches #id exactly, not as a substring", () => {
    expect(matchesWorkItemQuery(item({ id: 1234 }), parseSearchQuery("#1234"))).toBe(true);
    expect(matchesWorkItemQuery(item({ id: 123 }), parseSearchQuery("#1234"))).toBe(false);
    expect(matchesWorkItemQuery(item({ id: 12345 }), parseSearchQuery("#1234"))).toBe(false);
  });

  it("filters by priority", () => {
    expect(matchesWorkItemQuery(item({ priority: 1 }), parseSearchQuery("p:1"))).toBe(true);
    expect(matchesWorkItemQuery(item({ priority: 2 }), parseSearchQuery("p:1"))).toBe(false);
    expect(matchesWorkItemQuery(item({ priority: null }), parseSearchQuery("p:1"))).toBe(false);
  });

  it("filters by assignee case-insensitively as a substring", () => {
    expect(matchesWorkItemQuery(item({ assignedTo: "Akira Nao" }), parseSearchQuery("@akira"))).toBe(true);
    expect(matchesWorkItemQuery(item({ assignedTo: "Someone Else" }), parseSearchQuery("@akira"))).toBe(false);
    expect(matchesWorkItemQuery(item({ assignedTo: null }), parseSearchQuery("@akira"))).toBe(false);
  });

  it("filters by state and type", () => {
    expect(matchesWorkItemQuery(item({ state: "Active" }), parseSearchQuery("s:active"))).toBe(true);
    expect(matchesWorkItemQuery(item({ state: "Closed" }), parseSearchQuery("s:active"))).toBe(false);
    expect(matchesWorkItemQuery(item({ workItemType: "Bug" }), parseSearchQuery("t:bug"))).toBe(true);
    expect(matchesWorkItemQuery(item({ workItemType: "Task" }), parseSearchQuery("t:bug"))).toBe(false);
  });

  it("requires all combined prefixes and free-text terms", () => {
    const match = item({ priority: 1, state: "Active", assignedTo: "aksh0", title: "Login flow" });
    expect(matchesWorkItemQuery(match, parseSearchQuery("p:1 s:active @aksh0 login"))).toBe(true);
    expect(
      matchesWorkItemQuery({ ...match, state: "Closed" }, parseSearchQuery("p:1 s:active @aksh0 login")),
    ).toBe(false);
    expect(
      matchesWorkItemQuery({ ...match, title: "Logout flow" }, parseSearchQuery("p:1 s:active @aksh0 login")),
    ).toBe(false);
  });

  it("matches free text against the id and tags", () => {
    expect(matchesWorkItemQuery(item({ id: 42, tags: ["urgent"] }), parseSearchQuery("42"))).toBe(true);
    expect(matchesWorkItemQuery(item({ tags: ["urgent"] }), parseSearchQuery("urgent"))).toBe(true);
  });
});

describe("singleIdJump", () => {
  it("returns the id when only #id is typed", () => {
    expect(singleIdJump(parseSearchQuery("#1234"))).toBe(1234);
  });

  it("returns null when other terms are present", () => {
    expect(singleIdJump(parseSearchQuery("#1234 login"))).toBeNull();
    expect(singleIdJump(parseSearchQuery("#1234 p:1"))).toBeNull();
    expect(singleIdJump(parseSearchQuery("p:1"))).toBeNull();
    expect(singleIdJump(parseSearchQuery(""))).toBeNull();
  });
});
