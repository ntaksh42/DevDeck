import { describe, expect, it } from "vitest";
import { extractCommitQuery } from "./commitQuery";

describe("extractCommitQuery", () => {
  it("returns the raw text as keyword when no path token is present", () => {
    expect(extractCommitQuery("fix retry parsing")).toEqual({
      keyword: "fix retry parsing",
      itemPath: null,
    });
  });

  it("pulls an unquoted path token out of the keyword", () => {
    expect(extractCommitQuery("fix bug path:src/auth")).toEqual({
      keyword: "fix bug",
      itemPath: "src/auth",
    });
  });

  it("supports a quoted path with spaces", () => {
    expect(extractCommitQuery('path:"src/my dir" hello')).toEqual({
      keyword: "hello",
      itemPath: "src/my dir",
    });
  });

  it("keeps the last path token when several are given", () => {
    expect(extractCommitQuery("path:a/b path:c/d")).toEqual({
      keyword: "",
      itemPath: "c/d",
    });
  });

  it("ignores a bare path: with no value", () => {
    expect(extractCommitQuery("path:")).toEqual({
      keyword: "path:",
      itemPath: null,
    });
  });
});
