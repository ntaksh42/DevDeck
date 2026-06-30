import { describe, expect, it } from "vitest";
import { lineHash, parseLineHash, webUrl } from "./codeBrowseShared";

describe("parseLineHash", () => {
  it("parses a single-line hash", () => {
    expect(parseLineHash("#L10")).toEqual({ start: 10, end: 10 });
  });

  it("parses a range hash", () => {
    expect(parseLineHash("#L10-L20")).toEqual({ start: 10, end: 20 });
  });

  it("normalizes a reversed range", () => {
    expect(parseLineHash("#L20-L10")).toEqual({ start: 10, end: 20 });
  });

  it("returns null for an empty hash", () => {
    expect(parseLineHash("")).toBeNull();
  });

  it("returns null for an unrelated hash", () => {
    expect(parseLineHash("#section-2")).toBeNull();
  });

  it("returns null for line 0", () => {
    expect(parseLineHash("#L0")).toBeNull();
  });
});

describe("lineHash", () => {
  it("builds a single-line hash when start equals end", () => {
    expect(lineHash({ start: 5, end: 5 })).toBe("#L5");
  });

  it("builds a range hash", () => {
    expect(lineHash({ start: 10, end: 20 })).toBe("#L10-L20");
  });

  it("round-trips through parseLineHash", () => {
    const range = { start: 3, end: 8 };
    expect(parseLineHash(lineHash(range))).toEqual(range);
  });
});

describe("webUrl with a line range", () => {
  const repo = { projectId: "p1", projectName: "Platform", repositoryId: "r1", repositoryName: "azdo-dashboard" };
  const organization = { id: "org1", name: "org1", baseUrl: "https://dev.azure.com/org1" } as never;

  it("omits line params when no range is given", () => {
    expect(webUrl(organization, repo, "/src/main.ts", "main")).not.toContain("line=");
  });

  it("appends Azure DevOps Web's line/lineEnd query params for a range", () => {
    const url = webUrl(organization, repo, "/src/main.ts", "main", { start: 10, end: 20 });
    expect(url).toContain("line=10");
    expect(url).toContain("lineEnd=20");
  });
});
