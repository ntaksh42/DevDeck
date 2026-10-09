import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ANALYZE_GROUPS,
  MAX_ANALYZE_GROUP_MEMBERS,
  type AnalyzeGroup,
  isAnalyzeGroupComplete,
  loadAnalyzeGroups,
  normalizeAnalyzeGroup,
  parseAnalyzeGroupsImport,
  createAnalyzeGroupsExport,
  saveAnalyzeGroups,
} from "./analyzeGroupsStorage";

function group(overrides: Partial<AnalyzeGroup> = {}): AnalyzeGroup {
  return {
    id: "g1",
    name: "Payments",
    organizationId: "org1",
    projectId: "proj1",
    queries: [{ id: "q1", name: "Bugs", projectId: "", wiql: "SELECT [System.Id] FROM WorkItems" }],
    granularity: "day",
    rangeCount: 30,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("normalizeAnalyzeGroup", () => {
  it("keeps a well-formed group", () => {
    expect(normalizeAnalyzeGroup(group())).toEqual(group());
  });

  it("rejects a group without an id or name", () => {
    expect(normalizeAnalyzeGroup({ ...group(), id: "" })).toBeNull();
    expect(normalizeAnalyzeGroup({ ...group(), name: "   " })).toBeNull();
  });

  it("drops query members with an empty WIQL", () => {
    const normalized = normalizeAnalyzeGroup(
      group({ queries: [{ id: "q1", name: "x", projectId: "", wiql: "  " }] }),
    );
    expect(normalized?.queries).toHaveLength(0);
  });

  it("caps the number of query members", () => {
    const many = Array.from({ length: MAX_ANALYZE_GROUP_MEMBERS + 3 }, (_, index) => ({
      id: `q${index}`,
      name: `Q${index}`,
      projectId: "",
      wiql: "SELECT [System.Id] FROM WorkItems",
    }));
    const normalized = normalizeAnalyzeGroup(group({ queries: many }));
    expect(normalized?.queries).toHaveLength(MAX_ANALYZE_GROUP_MEMBERS);
  });

  it("drops branch members left over from the retired branch charts", () => {
    const legacy = { ...group(), branches: [{ id: "b1", repositoryId: "r", branch: "main" }] };
    expect(normalizeAnalyzeGroup(legacy)).toEqual(group());
  });

  it("falls back to the default range when the stored value is unusable", () => {
    expect(normalizeAnalyzeGroup(group({ rangeCount: 0 }))?.rangeCount).toBe(30);
    expect(
      normalizeAnalyzeGroup(group({ granularity: "week", rangeCount: Number.NaN }))?.rangeCount,
    ).toBe(12);
  });

  it("clamps a range outside the offered options", () => {
    expect(normalizeAnalyzeGroup(group({ rangeCount: 900 }))?.rangeCount).toBe(90);
    expect(normalizeAnalyzeGroup(group({ rangeCount: 2 }))?.rangeCount).toBe(7);
  });

  it("treats an unknown granularity as day", () => {
    const normalized = normalizeAnalyzeGroup({ ...group(), granularity: "month" });
    expect(normalized?.granularity).toBe("day");
  });
});

describe("isAnalyzeGroupComplete", () => {
  it("requires a name and at least one member", () => {
    expect(isAnalyzeGroupComplete(group())).toBe(true);
    expect(isAnalyzeGroupComplete(group({ queries: [] }))).toBe(false);
    expect(isAnalyzeGroupComplete(group({ name: " " }))).toBe(false);
  });
});

describe("load and save", () => {
  it("round-trips groups through localStorage", () => {
    saveAnalyzeGroups([group()]);
    expect(loadAnalyzeGroups()).toEqual([group()]);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadAnalyzeGroups()).toEqual([]);
  });

  it("returns an empty list when the stored value is not valid JSON", () => {
    window.localStorage.setItem("azdodeck:analyze:groups", "{oops");
    expect(loadAnalyzeGroups()).toEqual([]);
  });

  it("skips malformed entries instead of discarding the whole list", () => {
    window.localStorage.setItem(
      "azdodeck:analyze:groups",
      JSON.stringify([group(), { id: "" }, group({ id: "g2" })]),
    );
    expect(loadAnalyzeGroups().map((entry) => entry.id)).toEqual(["g1", "g2"]);
  });

  it("caps the number of stored groups", () => {
    const many = Array.from({ length: MAX_ANALYZE_GROUPS + 5 }, (_, index) =>
      group({ id: `g${index}` }),
    );
    saveAnalyzeGroups(many);
    expect(loadAnalyzeGroups()).toHaveLength(MAX_ANALYZE_GROUPS);
  });
});

describe("import and export", () => {
  it("round-trips through the export envelope", () => {
    const exported = JSON.stringify(createAnalyzeGroupsExport([group()]));
    expect(parseAnalyzeGroupsImport(exported)).toEqual([group()]);
  });

  it("accepts a bare array of groups", () => {
    expect(parseAnalyzeGroupsImport(JSON.stringify([group()]))).toEqual([group()]);
  });

  it("rejects JSON that is not a group export", () => {
    expect(() => parseAnalyzeGroupsImport(JSON.stringify({ schema: "other" }))).toThrow();
  });

  it("rejects an export whose groups are all malformed", () => {
    expect(() => parseAnalyzeGroupsImport(JSON.stringify([{ id: "" }]))).toThrow();
  });
});
