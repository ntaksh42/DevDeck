import { describe, expect, it } from "vitest";
import { fileVersion, isUnderFolder, refVersion, revisionFor } from "./compareRevisions";

describe("revisionFor", () => {
  it("uses the branch when nothing is typed", () => {
    expect(revisionFor("", "main")).toEqual({ type: "branch", value: "main" });
    expect(revisionFor("   ", "main")).toEqual({ type: "branch", value: "main" });
  });

  it("lets a typed SHA or tag override the branch", () => {
    expect(revisionFor("abc1234", "main")).toEqual({ type: "commit", value: "abc1234" });
    expect(revisionFor(" v1.2 ", "main")).toEqual({ type: "tag", value: "v1.2" });
  });

  it("is null when there is neither a typed ref nor a branch", () => {
    expect(revisionFor("", "")).toBeNull();
  });
});

describe("refVersion / fileVersion", () => {
  it("treats 7-40 hex digits as a commit and anything else as a tag", () => {
    expect(refVersion("0123abc")).toEqual({ versionType: "commit", version: "0123abc" });
    expect(refVersion("release-1")).toEqual({ versionType: "tag", version: "release-1" });
    expect(refVersion("abc12")).toEqual({ versionType: "tag", version: "abc12" });
  });

  it("needs no explicit version for a branch tip", () => {
    expect(fileVersion({ type: "branch", value: "main" })).toBeUndefined();
    expect(fileVersion({ type: "tag", value: "v1" })).toEqual({
      versionType: "tag",
      version: "v1",
    });
  });
});

describe("isUnderFolder", () => {
  it("matches the folder, its descendants and everything for the root", () => {
    expect(isUnderFolder("/src/a.ts", "/src")).toBe(true);
    expect(isUnderFolder("/src/a.ts", "/src/")).toBe(true);
    expect(isUnderFolder("/src", "/src")).toBe(true);
    expect(isUnderFolder("/srcother/a.ts", "/src")).toBe(false);
    expect(isUnderFolder("/anything", "/")).toBe(true);
  });
});
