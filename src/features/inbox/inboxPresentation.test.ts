import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/lib/azdoCommands";
import {
  extractInboxLinks,
  inboxKindLabel,
  inboxLocationLabel,
  inboxRowTitle,
  matchesInboxFilter,
  shortRefName,
} from "./inboxPresentation";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 1,
    organizationId: "org",
    kind: "pr_mention",
    subjectId: 42,
    projectId: "p",
    projectName: "Platform",
    repositoryId: "r",
    repositoryName: "api-gateway",
    threadId: 1,
    commentId: 1,
    title: "Fix null handling",
    author: "Tanaka",
    snippet: "@you please check",
    webUrl: null,
    state: "open",
    snoozedUntil: null,
    detectedAt: "2026-10-10T00:00:00Z",
    doneAt: null,
    filePath: null,
    line: null,
    insight: null,
    ...overrides,
  };
}

describe("extractInboxLinks", () => {
  it("finds work items, pull requests and urls in order without duplicates", () => {
    const links = extractInboxLinks([
      "see AB#3120 and https://learn.microsoft.com/azure/null.",
      "also !455, AB#3120 again, https://learn.microsoft.com/azure/null",
    ]);
    expect(links.map((link) => link.label)).toEqual([
      "AB#3120",
      "learn.microsoft.com/azure/null",
      "!455",
    ]);
    expect(links[1]).toMatchObject({
      kind: "external",
      url: "https://learn.microsoft.com/azure/null",
    });
  });

  it("returns nothing for empty input and ignores non-links", () => {
    expect(extractInboxLinks([null, undefined, "plain text, no links #12"])).toEqual([]);
  });

  it("does not treat a path segment as a pull request mention", () => {
    expect(extractInboxLinks(["https://dev.azure.com/o/p/_git/r/pullrequest/9!x"])).toHaveLength(1);
  });
});

describe("inboxRowTitle", () => {
  it("returns the title for comment rows so the row says what it is about", () => {
    expect(inboxRowTitle(item())).toBe("Fix null handling");
    expect(inboxRowTitle(item({ kind: "wi_mention", title: "Login is slow" }))).toBe(
      "Login is slow",
    );
  });

  it("has none when the row already shows the title", () => {
    expect(inboxRowTitle(item({ kind: "pr_review_request", snippet: null }))).toBeNull();
    expect(inboxRowTitle(item({ snippet: "Fix null handling" }))).toBeNull();
  });
});

describe("inbox presentation helpers", () => {
  it("labels known kinds and falls back to the raw kind", () => {
    expect(inboxKindLabel("pr_mention")).toBe("Mention");
    expect(inboxKindLabel("wi_mention")).toBe("WI mention");
    expect(inboxKindLabel("pr_review_request")).toBe("Review");
    expect(inboxKindLabel("future_kind")).toBe("future_kind");
  });

  it("shortens branch refs", () => {
    expect(shortRefName("refs/heads/feature/x")).toBe("feature/x");
    expect(shortRefName("main")).toBe("main");
  });

  it("filters across title, author, snippet, repository and PR number", () => {
    const target = item();
    expect(matchesInboxFilter(target, "")).toBe(true);
    expect(matchesInboxFilter(target, "null")).toBe(true);
    expect(matchesInboxFilter(target, "TANAKA")).toBe(true);
    expect(matchesInboxFilter(target, "gateway")).toBe(true);
    expect(matchesInboxFilter(target, "!42")).toBe(true);
    expect(matchesInboxFilter(target, "billing")).toBe(false);
  });
});

describe("inboxLocationLabel", () => {
  it("names the file and line of a code comment", () => {
    expect(inboxLocationLabel({ filePath: "/src/app/dashboard.ts", line: 7 })).toBe("dashboard.ts:7");
    expect(inboxLocationLabel({ filePath: "/README.md", line: null })).toBe("README.md");
    expect(inboxLocationLabel({ filePath: null, line: null })).toBeNull();
  });
});
