import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ANALYZE_GROUPS,
  MAX_ANALYZE_GROUP_MEMBERS,
  type AnalyzeGroup,
  isAnalyzeGroupComplete,
  loadAnalyzeGroups,
  normalizeAnalyzeGroup,
  normalizeBranchName,
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
    queries: [
      {
        id: "q1",
        name: "Bugs",
        projectId: "",
        wiql: "SELECT [System.Id] FROM WorkItems",
        milestones: [],
      },
    ],
    branches: [],
    breakdownAxis: "assignedTo",
    granularity: "day",
    rangeCount: 30,
    rangePreset: "count",
    rangeFrom: "",
    rangeTo: "",
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

  it("accepts a group with only branches", () => {
    const branchOnly = group({
      queries: [],
      branches: [
        {
          id: "b1",
          name: "main",
          projectId: "",
          repositoryId: "repo1",
          repositoryName: "api",
          branch: "main",
        },
      ],
    });
    expect(normalizeAnalyzeGroup(branchOnly)?.branches).toHaveLength(1);
  });

  it("drops query members with an empty WIQL", () => {
    const normalized = normalizeAnalyzeGroup(
      group({ queries: [{ id: "q1", name: "x", projectId: "", wiql: "  ", milestones: [] }] }),
    );
    expect(normalized?.queries).toHaveLength(0);
  });

  it("drops branch members without a repository or branch", () => {
    const normalized = normalizeAnalyzeGroup(
      group({
        branches: [
          { id: "b1", name: "", projectId: "", repositoryId: "", repositoryName: "", branch: "main" },
          { id: "b2", name: "", projectId: "", repositoryId: "r", repositoryName: "", branch: "  " },
        ] as AnalyzeGroup["branches"],
      }),
    );
    expect(normalized?.branches).toHaveLength(0);
  });

  it("stores branches in short form", () => {
    const normalized = normalizeAnalyzeGroup(
      group({
        branches: [
          {
            id: "b1",
            name: "",
            projectId: "",
            repositoryId: "r",
            repositoryName: "api",
            branch: "refs/heads/release/2.4",
          },
        ],
      }),
    );
    expect(normalized?.branches[0].branch).toBe("release/2.4");
    // The name falls back to the branch when one was not supplied.
    expect(normalized?.branches[0].name).toBe("release/2.4");
  });

  it("caps members across queries and branches combined", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      id: `q${index}`,
      name: `Q${index}`,
      projectId: "",
      wiql: "SELECT [System.Id] FROM WorkItems",
      milestones: [],
    }));
    const branches = Array.from({ length: 10 }, (_, index) => ({
      id: `b${index}`,
      name: `B${index}`,
      projectId: "",
      repositoryId: "r",
      repositoryName: "api",
      branch: `feature/${index}`,
    }));
    const normalized = normalizeAnalyzeGroup(group({ queries: many, branches }));
    expect(normalized!.queries.length + normalized!.branches.length).toBe(
      MAX_ANALYZE_GROUP_MEMBERS,
    );
    // Queries are the costlier half, so they keep their slots first.
    expect(normalized?.queries).toHaveLength(10);
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
    const normalized = normalizeAnalyzeGroup({ ...group(), granularity: "fortnight" });
    expect(normalized?.granularity).toBe("day");
  });

  it("keeps the month granularity", () => {
    const normalized = normalizeAnalyzeGroup({
      ...group(),
      granularity: "month",
      rangeCount: 6,
    });
    expect(normalized?.granularity).toBe("month");
    expect(normalized?.rangeCount).toBe(6);
  });

  it("keeps milestones sorted and drops unusable ones", () => {
    const normalized = normalizeAnalyzeGroup(
      group({
        queries: [
          {
            id: "q1",
            name: "Bugs",
            projectId: "",
            wiql: "SELECT [System.Id] FROM WorkItems",
            milestones: [
              { date: "2026-08-03", count: 12 },
              { date: "2026-07-14", count: 24 },
              { date: "bogus", count: 5 },
            ],
          },
        ],
      }),
    );
    expect(normalized?.queries[0].milestones).toEqual([
      { date: "2026-07-14", count: 24 },
      { date: "2026-08-03", count: 12 },
    ]);
  });

  it("defaults the range preset and custom dates", () => {
    const normalized = normalizeAnalyzeGroup({
      ...group(),
      rangePreset: "bogus",
      rangeFrom: "nope",
      rangeTo: "2026-08-05",
    });
    expect(normalized?.rangePreset).toBe("count");
    expect(normalized?.rangeFrom).toBe("");
    expect(normalized?.rangeTo).toBe("2026-08-05");
  });
});

describe("normalizeBranchName", () => {
  it("strips a refs/heads prefix and trims", () => {
    expect(normalizeBranchName("  refs/heads/main ")).toBe("main");
    expect(normalizeBranchName("develop")).toBe("develop");
  });
});

describe("isAnalyzeGroupComplete", () => {
  it("requires a name and at least one member", () => {
    expect(isAnalyzeGroupComplete(group())).toBe(true);
    expect(isAnalyzeGroupComplete(group({ queries: [], branches: [] }))).toBe(false);
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
