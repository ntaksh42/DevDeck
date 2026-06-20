import { afterEach, describe, expect, it } from "vitest";
import {
  consumePendingSearchPreset,
  loadSearchPresets,
  newSearchPresetId,
  requestApplySearchPreset,
  saveSearchPresets,
  type PrSearchPayload,
  type WorkItemSearchPayload,
} from "./searchPresets";

afterEach(() => {
  window.localStorage.clear();
  // Drain any pending apply between tests.
  consumePendingSearchPreset("pr");
  consumePendingSearchPreset("commit");
  consumePendingSearchPreset("workItem");
});

const prPayload: PrSearchPayload = {
  organizationId: "contoso",
  query: "auth",
  projectId: "p1",
  repositoryId: "r1",
};

describe("saveSearchPresets / loadSearchPresets", () => {
  it("round-trips presets per kind", () => {
    saveSearchPresets("pr", [{ id: "a", name: "Auth PRs", payload: prPayload }]);
    const loaded = loadSearchPresets<PrSearchPayload>("pr");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Auth PRs");
    expect(loaded[0].payload.query).toBe("auth");
    // Other kinds are isolated.
    expect(loadSearchPresets("commit")).toEqual([]);
  });

  it("returns [] for missing or malformed storage", () => {
    expect(loadSearchPresets("workItem")).toEqual([]);
    window.localStorage.setItem("azdodeck:savedSearches:workItem:v1", "not json");
    expect(loadSearchPresets("workItem")).toEqual([]);
  });

  it("drops entries missing required fields", () => {
    window.localStorage.setItem(
      "azdodeck:savedSearches:pr:v1",
      JSON.stringify([
        { id: "ok", name: "Good", payload: prPayload },
        { id: "x" },
        { name: "no id", payload: prPayload },
        { id: "y", name: "no payload" },
      ]),
    );
    const loaded = loadSearchPresets<PrSearchPayload>("pr");
    expect(loaded.map((p) => p.id)).toEqual(["ok"]);
  });

  it("generates unique-ish ids", () => {
    expect(newSearchPresetId()).not.toBe(newSearchPresetId());
  });
});

describe("requestApplySearchPreset / consumePendingSearchPreset", () => {
  it("parks an apply for the matching kind and consumes it once", () => {
    const payload: WorkItemSearchPayload = {
      query: "bug",
      state: "Active",
      workItemType: "Bug",
      projectId: "",
    };
    requestApplySearchPreset("workItem", payload);
    // A different kind sees nothing.
    expect(consumePendingSearchPreset("pr")).toBeNull();
    // The target kind consumes it, then it is gone.
    expect(consumePendingSearchPreset<WorkItemSearchPayload>("workItem")).toEqual(payload);
    expect(consumePendingSearchPreset("workItem")).toBeNull();
  });
});
