import { beforeEach, describe, expect, it } from "vitest";
import {
  WI_VIEW_COUNT_BASELINES_STORAGE_KEY,
  normalizeWorkItemQueryView,
  recordViewCount,
  resetViewCountSessionForTests,
  viewCountBaseline,
} from "./workItemViewsStorage";

const baseView = {
  id: "wi-view-1",
  name: "Active bugs",
  projectId: "project-1",
  wiql: "SELECT [System.Id] FROM WorkItems",
  limit: 200,
};

describe("normalizeWorkItemQueryView", () => {
  it("keeps refresh interval and alert threshold when valid", () => {
    const view = normalizeWorkItemQueryView({
      ...baseView,
      refreshIntervalSec: 60,
      alertThreshold: 5,
    });
    expect(view?.refreshIntervalSec).toBe(60);
    expect(view?.alertThreshold).toBe(5);
  });

  it("clamps the refresh interval into the allowed range", () => {
    expect(
      normalizeWorkItemQueryView({ ...baseView, refreshIntervalSec: 1 })?.refreshIntervalSec,
    ).toBe(15);
    expect(
      normalizeWorkItemQueryView({ ...baseView, refreshIntervalSec: 999999 })?.refreshIntervalSec,
    ).toBe(3600);
  });

  it("drops invalid or missing refresh interval and threshold", () => {
    const view = normalizeWorkItemQueryView({
      ...baseView,
      refreshIntervalSec: "abc",
      alertThreshold: -1,
    });
    expect(view?.refreshIntervalSec).toBeUndefined();
    expect(view?.alertThreshold).toBeUndefined();
    const plain = normalizeWorkItemQueryView(baseView);
    expect(plain?.refreshIntervalSec).toBeUndefined();
    expect(plain?.alertThreshold).toBeUndefined();
  });

  it("keeps a zero alert threshold", () => {
    expect(normalizeWorkItemQueryView({ ...baseView, alertThreshold: 0 })?.alertThreshold).toBe(0);
  });

  it("makes views unbounded when no usable limit is stored", () => {
    expect(normalizeWorkItemQueryView({ ...baseView, limit: undefined })?.limit).toBeUndefined();
    expect(normalizeWorkItemQueryView({ ...baseView, limit: 0 })?.limit).toBeUndefined();
    expect(normalizeWorkItemQueryView({ ...baseView, limit: "abc" })?.limit).toBeUndefined();
  });

  it("drops the legacy 200 cap so old views become unbounded", () => {
    expect(normalizeWorkItemQueryView(baseView)?.limit).toBeUndefined();
  });

  it("keeps an explicit limit above the old 500 ceiling", () => {
    expect(normalizeWorkItemQueryView({ ...baseView, limit: 5000 })?.limit).toBe(5000);
  });

  it("migrates extra columns saved as plain reference-name strings", () => {
    expect(
      normalizeWorkItemQueryView({ ...baseView, extraColumns: ["Custom.ReleaseTrain"] })
        ?.extraColumns,
    ).toEqual([{ referenceName: "Custom.ReleaseTrain" }]);
  });

  it("keeps the field type on typed extra columns", () => {
    expect(
      normalizeWorkItemQueryView({
        ...baseView,
        extraColumns: [{ referenceName: "Custom.Due", fieldType: "dateTime" }],
      })?.extraColumns,
    ).toEqual([{ referenceName: "Custom.Due", fieldType: "dateTime" }]);
  });

  it("keeps a sort key pointing at an extra column", () => {
    expect(
      normalizeWorkItemQueryView({ ...baseView, sortKey: "extra:custom.due" })?.sortKey,
    ).toBe("extra:custom.due");
  });

  it("falls back to changedDate for an unknown sort key", () => {
    expect(normalizeWorkItemQueryView({ ...baseView, sortKey: "bogus" })?.sortKey).toBe(
      "changedDate",
    );
  });
});

describe("view count baselines", () => {
  beforeEach(() => {
    window.localStorage.removeItem(WI_VIEW_COUNT_BASELINES_STORAGE_KEY);
    resetViewCountSessionForTests();
  });

  it("returns null when no baseline was recorded", () => {
    expect(viewCountBaseline("wi-view-1")).toBeNull();
  });

  it("freezes the baseline for the session while persisting new counts", () => {
    window.localStorage.setItem(
      WI_VIEW_COUNT_BASELINES_STORAGE_KEY,
      JSON.stringify({ "wi-view-1": 4 }),
    );
    expect(viewCountBaseline("wi-view-1")).toBe(4);

    recordViewCount("wi-view-1", 7, ["wi-view-1"]);
    // Baseline stays at the previous-session value within this session.
    expect(viewCountBaseline("wi-view-1")).toBe(4);
    // The next session reads the latest persisted count.
    expect(
      JSON.parse(window.localStorage.getItem(WI_VIEW_COUNT_BASELINES_STORAGE_KEY) ?? "{}"),
    ).toEqual({ "wi-view-1": 7 });
  });

  it("prunes counts for deleted views", () => {
    window.localStorage.setItem(
      WI_VIEW_COUNT_BASELINES_STORAGE_KEY,
      JSON.stringify({ "wi-view-1": 4, "wi-view-gone": 9 }),
    );
    recordViewCount("wi-view-1", 5, ["wi-view-1"]);
    expect(
      JSON.parse(window.localStorage.getItem(WI_VIEW_COUNT_BASELINES_STORAGE_KEY) ?? "{}"),
    ).toEqual({ "wi-view-1": 5 });
  });
});
