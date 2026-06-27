import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ROW_COLOR_RULES_STORAGE_KEY,
  loadRowColorRules,
  matchRowColorClass,
  saveRowColorRules,
  type RowColorRule,
} from "./rowColorRules";

function rule(partial: Partial<RowColorRule>): RowColorRule {
  return {
    id: "r1",
    field: "state",
    op: "equals",
    value: "Blocked",
    color: "red",
    ...partial,
  };
}

describe("matchRowColorClass", () => {
  it("returns the first matching rule's tint (first match wins)", () => {
    const rules = [
      rule({ id: "a", field: "state", op: "equals", value: "Blocked", color: "red" }),
      rule({ id: "b", field: "type", op: "equals", value: "Bug", color: "amber" }),
    ];
    const cls = matchRowColorClass({ state: "Blocked", type: "Bug" }, rules);
    expect(cls).toContain("bg-red-100");
  });

  it("matches case-insensitively and supports contains", () => {
    const rules = [rule({ field: "title", op: "contains", value: "urgent", color: "orange" })];
    expect(matchRowColorClass({ title: "URGENT: fix" }, rules)).toContain("bg-orange-100");
    expect(matchRowColorClass({ title: "later" }, rules)).toBeNull();
  });

  it("ignores rules with an empty value or a missing field", () => {
    expect(matchRowColorClass({ state: "Active" }, [rule({ value: "  " })])).toBeNull();
    expect(matchRowColorClass({ state: null }, [rule({ value: "Active" })])).toBeNull();
  });
});

describe("loadRowColorRules / saveRowColorRules", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("round-trips valid rules and drops invalid entries", () => {
    saveRowColorRules([rule({ id: "x", color: "green" })]);
    expect(loadRowColorRules()).toEqual([rule({ id: "x", color: "green" })]);
  });

  it("clears storage when saving an empty list", () => {
    saveRowColorRules([rule({})]);
    saveRowColorRules([]);
    expect(window.localStorage.getItem(ROW_COLOR_RULES_STORAGE_KEY)).toBeNull();
  });

  it("tolerates corrupt storage", () => {
    window.localStorage.setItem(ROW_COLOR_RULES_STORAGE_KEY, "{not json");
    expect(loadRowColorRules()).toEqual([]);
  });
});
