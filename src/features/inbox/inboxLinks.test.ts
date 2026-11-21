import { describe, expect, it } from "vitest";
import type { PrThread, WorkItemPreview } from "@/lib/azdoCommands";
import { mergeInboxLinks, pullRequestInboxLinks, pullRequestWorkItemIds, richTextSources, workItemInboxLinks } from "./inboxLinks";
import { extractInboxLinks, type InboxEntry } from "./inboxPresentation";

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: "1",
    kind: "pr_mention",
    subjectId: 42,
    commentId: 7,
    threadId: 3,
    title: "Fix",
    snippet: null,
    webUrl: "https://dev.azure.com/o/p/_git/r/pullrequest/42",
    ...overrides,
  } as InboxEntry;
}

function thread(contents: string[]): PrThread {
  return {
    id: 3,
    status: "active",
    isResolved: false,
    filePath: null,
    rightLine: null,
    leftLine: null,
    comments: contents.map((content, index) => ({
      id: index + 1,
      parentCommentId: null,
      content,
      author: "A",
      publishedDate: null,
      isSystem: false,
      isMine: false,
    })),
  };
}

describe("mergeInboxLinks", () => {
  it("keeps the first of duplicates and orders by origin", () => {
    const merged = mergeInboxLinks(
      [{ kind: "workItem", id: 5, label: "#5", origin: "linked", title: "Five" }],
      extractInboxLinks(["AB#5 https://x.test/a"], "comment"),
    );
    expect(merged.map((link) => `${link.origin}:${link.label}`)).toEqual([
      "linked:#5",
      "comment:x.test/a",
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("richTextSources", () => {
  it("returns the visible text and the anchor targets, decoded", () => {
    const sources = richTextSources('<p>see <a href="https://x.test/a?b=1&amp;c=2">here</a></p>');
    expect(sources).toContain("https://x.test/a?b=1&c=2");
    expect(richTextSources(null)).toEqual([]);
  });
});

describe("pullRequestWorkItemIds", () => {
  it("joins the linked ids with AB# mentions in the description", () => {
    expect(pullRequestWorkItemIds([9, 3], "closes AB#5 and AB#3")).toEqual([3, 5, 9]);
  });
});

describe("pullRequestInboxLinks", () => {
  it("lists linked work items first, then description and thread links, without the PR itself", () => {
    const links = pullRequestInboxLinks(
      entry(),
      { description: "spec: https://wiki.test/spec !42" } as never,
      thread(["see AB#9 and !50", "https://dev.azure.com/o/p/_git/r/pullrequest/42"]),
      [{ id: 9, title: "Login bug", state: "Active" }],
    );
    expect(links.map((link) => `${link.origin}:${link.label}`)).toEqual([
      "linked:#9",
      "description:wiki.test/spec",
      "comment:!50",
    ]);
    expect(links[0]).toMatchObject({ title: "Login bug", detail: "Active" });
  });
});

describe("workItemInboxLinks", () => {
  const workItem = {
    relations: [{ relationType: "Parent", id: 10, title: "Epic", state: "Active", workItemType: "Epic", webUrl: null }],
    pullRequests: [
      { pullRequestId: 77, repositoryId: "repo-1", title: "Add login", status: "active", myVoteLabel: null, webUrl: null },
    ],
    attachments: [{ name: "trace.zip", url: "https://files.test/trace.zip" }],
    descriptionHtml: '<p>Repro: <a href="https://wiki.test/repro">steps</a></p>',
    comments: [
      { id: 1, text: "older https://old.test/x", renderedText: null },
      { id: 2, text: "@me please look https://mention.test/y", renderedText: null },
    ],
  } as unknown as WorkItemPreview;

  it("collects relations, pull requests, description, comments (mention first) and attachments", () => {
    const links = workItemInboxLinks(entry({ kind: "wi_mention", subjectId: 5, commentId: 2 }), workItem);
    expect(links.map((link) => `${link.origin}:${link.label}`)).toEqual([
      "linked:#10",
      "linked:!77",
      "description:wiki.test/repro",
      "comment:mention.test/y",
      "comment:old.test/x",
      "attachment:trace.zip",
    ]);
    expect(links[0]).toMatchObject({ title: "Epic", detail: "Parent · Active" });
    expect(links[1]).toMatchObject({ kind: "pullRequest", repositoryId: "repo-1", title: "Add login" });
  });

  it("falls back to the snippet while the work item is loading", () => {
    const links = workItemInboxLinks(entry({ kind: "wi_mention", snippet: "see AB#8" }), null);
    expect(links.map((link) => link.label)).toEqual(["AB#8"]);
  });
});
