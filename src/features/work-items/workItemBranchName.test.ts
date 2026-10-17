import { describe, expect, it } from "vitest";
import { defaultWorkItemBranchName } from "./workItemBranchName";

describe("defaultWorkItemBranchName", () => {
  it("builds type/id-slug from the title", () => {
    expect(defaultWorkItemBranchName("Bug", 123, "Fix login redirect")).toBe(
      "bug/123-fix-login-redirect",
    );
  });

  it("turns spaces and symbols into single hyphens and trims them", () => {
    expect(defaultWorkItemBranchName("User Story", 7, '  [API]: "Add" /v2//users?  ')).toBe(
      "user-story/7-api-add-v2-users",
    );
  });

  it("keeps Japanese titles", () => {
    expect(defaultWorkItemBranchName("Task", 9, "ログイン画面の修正")).toBe("task/9-ログイン画面の修正");
  });

  it("falls back when the type or title has nothing usable", () => {
    expect(defaultWorkItemBranchName(null, 5, "!!!")).toBe("work-item/5");
  });

  it("caps the slug length without leaving a trailing hyphen", () => {
    const name = defaultWorkItemBranchName("Task", 1, "a ".repeat(60));
    expect(name.length).toBeLessThanOrEqual("task/1-".length + 40);
    expect(name.endsWith("-")).toBe(false);
  });
});
