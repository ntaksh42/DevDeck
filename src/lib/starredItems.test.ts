import { afterEach, describe, expect, it } from "vitest";
import {
  STARRED_ITEMS_STORAGE_KEY,
  isStarred,
  loadStarredItems,
  removeStar,
  starKey,
  toggleStar,
} from "./starredItems";

afterEach(() => {
  window.localStorage.clear();
});

const base = {
  organizationId: "contoso",
  itemType: "work_item" as const,
  itemId: "42",
  title: "#42 Epic",
  webUrl: "https://dev.azure.com/contoso/_workitems/edit/42",
};

describe("toggleStar", () => {
  it("adds then removes a star and reports the new state", () => {
    expect(isStarred("contoso", "work_item", "42")).toBe(false);
    expect(toggleStar(base)).toBe(true);
    expect(isStarred("contoso", "work_item", "42")).toBe(true);
    expect(loadStarredItems()).toHaveLength(1);
    expect(toggleStar(base)).toBe(false);
    expect(isStarred("contoso", "work_item", "42")).toBe(false);
    expect(loadStarredItems()).toHaveLength(0);
  });

  it("keys by org + type + id so different types do not collide", () => {
    toggleStar(base);
    toggleStar({ ...base, itemType: "pull_request", title: "PR 42" });
    expect(isStarred("contoso", "work_item", "42")).toBe(true);
    expect(isStarred("contoso", "pull_request", "42")).toBe(true);
    expect(loadStarredItems()).toHaveLength(2);
  });

  it("does not collide across organizations", () => {
    toggleStar(base);
    expect(isStarred("fabrikam", "work_item", "42")).toBe(false);
  });
});

describe("persistence", () => {
  it("survives a fresh load from storage (simulating restart)", () => {
    toggleStar(base);
    expect(loadStarredItems()).toHaveLength(1);
  });

  it("keeps an orphan star with its last-known title/url", () => {
    toggleStar(base);
    // Item is gone from the server but the star (and snapshot) remain.
    const [orphan] = loadStarredItems();
    expect(orphan.title).toBe("#42 Epic");
    expect(orphan.webUrl).toBe(base.webUrl);
  });

  it("drops malformed entries on read", () => {
    window.localStorage.setItem(
      STARRED_ITEMS_STORAGE_KEY,
      JSON.stringify([{ organizationId: "contoso" }, "garbage"]),
    );
    expect(loadStarredItems()).toEqual([]);
  });
});

describe("removeStar", () => {
  it("removes regardless of current state", () => {
    toggleStar(base);
    removeStar("contoso", "work_item", "42");
    expect(isStarred("contoso", "work_item", "42")).toBe(false);
  });
});

describe("starKey", () => {
  it("builds a stable composite key", () => {
    expect(starKey("contoso", "pull_request", "7")).toBe("contoso:pull_request:7");
  });
});
