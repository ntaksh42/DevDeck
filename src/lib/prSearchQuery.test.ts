import { describe, expect, it } from "vitest";
import { matchesPrSearchQuery, parsePrSearchQuery } from "./prSearchQuery";
import type { PullRequestSummary } from "./commands/prs";

const pr: PullRequestSummary = {
  organizationId: "org", projectId: "p", projectName: "Platform",
  repositoryId: "r", repositoryName: "web-portal", pullRequestId: 1234,
  title: 'Fix LOGIN timeout 日本語 "quoted"', status: "active", createdBy: "Alice Johnson",
  creationDate: "2026-01-01T00:00:00Z", closedDate: null,
  sourceRefName: "fix/login", targetRefName: "main", webUrl: null, isDraft: false,
};
const matches = (query: string, exclude = "") => matchesPrSearchQuery(parsePrSearchQuery(query, exclude), pr);

describe("PR search grammar", () => {
  it("ANDs terms across metadata with case-insensitive Unicode matching", () => {
    expect(matches("WEB login 日本語 Alice")).toBe(true);
    expect(matches("login missing")).toBe(false);
    expect(parsePrSearchQuery("login OR timeout").map((term) => term.text)).toEqual(["login", "or", "timeout"]);
  });
  it("supports exclusions and quoted phrases without joining different fields", () => {
    expect(matches('login -test "login timeout"')).toBe(true);
    expect(matches('login -"login timeout"')).toBe(false);
    expect(matches('"portal Alice"')).toBe(false);
    expect(matches('"\\\"quoted\\\""')).toBe(true);
    expect(matches("", 'test "slow login"')).toBe(true);
    expect(matches("login", "main")).toBe(false);
  });
  it("distinguishes exact #IDs from bare numeric prefixes and quoted numbers", () => {
    expect(matches("#1234")).toBe(true);
    expect(matches("#123")).toBe(false);
    expect(matches("123")).toBe(true);
    expect(matches('"123"')).toBe(false);
    expect(matches("-#1234")).toBe(false);
    expect(matches("#1234 platform")).toBe(true);
  });
  it.each(['"open', '""', '-', '#0', '#abc', '#2147483648', 'foo"bar"', '"a"b', '"\\x"'])(
    "rejects malformed input %s", (input) => expect(() => parsePrSearchQuery(input)).toThrow(),
  );
  it("bounds lengths and terms across both fields", () => {
    expect(() => parsePrSearchQuery("あ".repeat(201))).toThrow();
    expect(() => parsePrSearchQuery("word ".repeat(10), "skip ".repeat(11))).toThrow();
    expect(parsePrSearchQuery("word ".repeat(20))).toHaveLength(20);
    expect(parsePrSearchQuery("😀".repeat(200))).toHaveLength(1);
  });
});
