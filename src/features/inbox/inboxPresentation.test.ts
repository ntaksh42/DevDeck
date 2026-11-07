import { describe, expect, it } from "vitest";
import type { InboxItem } from "@/lib/azdoCommands";
import {
  extractInboxLinks,
  inboxKindLabel,
  inboxLocationLabel,
  inboxRowSubject,
  isThreadItem,
  matchesInboxFilter,
  matchesInboxPriority,
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
    hitCount: 1,
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

describe("inboxRowSubject", () => {
  it("names the PR or work item by id and title so the row says what it is about", () => {
    expect(inboxRowSubject(item())).toBe("!42 Fix null handling");
    expect(inboxRowSubject(item({ kind: "wi_mention", subjectId: 7, title: "Login is slow" }))).toBe(
      "#7 Login is slow",
    );
  });

  it("falls back to the repository or project when there is no title", () => {
    expect(inboxRowSubject(item({ title: "" }))).toBe("!42 api-gateway");
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

describe("team mentions and work item replies", () => {
  it("files them under Other and keeps team mentions answerable in their thread", () => {
    for (const kind of ["pr_group_mention", "wi_reply"]) {
      expect(matchesInboxPriority({ kind }, "priority")).toBe(false);
      expect(matchesInboxPriority({ kind }, "other")).toBe(true);
    }
    expect(inboxKindLabel("pr_group_mention")).toBe("Team");
    expect(inboxKindLabel("wi_reply")).toBe("WI reply");
    expect(isThreadItem({ kind: "pr_group_mention" })).toBe(true);
  });
});

describe("Waiting rows (an overdue reply reminder)", () => {
  it("are labelled Waiting, count as Priority and keep their PR thread", () => {
    expect(inboxKindLabel("pr_waiting")).toBe("Waiting");
    expect(inboxKindLabel("wi_waiting")).toBe("Waiting");
    expect(matchesInboxPriority(item({ kind: "pr_waiting" }), "priority")).toBe(true);
    expect(matchesInboxPriority(item({ kind: "wi_waiting" }), "other")).toBe(false);
    expect(isThreadItem({ kind: "pr_waiting" })).toBe(true);
    expect(isThreadItem({ kind: "wi_waiting" })).toBe(false);
  });
});
