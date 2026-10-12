import { describe, expect, it, vi } from "vitest";
import { buildContextDocument } from "./contextDocument";
import { LIST_ROW_CAP, listMarkdown, markdownTable } from "./agentListScope";
import type { AgentSubject } from "./agentSubject";

function thread(id: number, content: string) {
  return {
    id,
    status: "active",
    isResolved: false,
    filePath: null,
    rightLine: null,
    comments: [{ author: "Alice", content, isSystem: false }],
  };
}

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  getPullRequestReview: vi.fn(async () => ({
    pullRequestId: 42,
    title: "Add search",
    description: "desc",
    sourceRefName: "refs/heads/a",
    targetRefName: "refs/heads/main",
    createdBy: "Bob",
    creationDate: "2026-10-01",
    isDraft: false,
    reviewers: [],
    threads: [thread(1, "first thread"), thread(2, "the mention"), thread(3, "third thread")],
  })),
  listPullRequestChanges: vi.fn(async () => ({ files: [] })),
}));

const pr: AgentSubject = {
  kind: "pull-request",
  id: 42,
  title: "Add search",
  projectId: "p",
  repositoryId: "r",
  repositoryName: "repo",
  webUrl: null,
};

describe("buildContextDocument", () => {
  it("puts the target thread first and marks it", async () => {
    const text = await buildContextDocument({ ...pr, kind: "pull-request", threadId: 2 });
    const order = ["Thread 2", "Thread 1", "Thread 3"].map((needle) => text.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain("Thread 2 [active] <- the thread this request is about");
  });

  it("keeps the thread order without a target thread", async () => {
    const text = await buildContextDocument(pr);
    expect(text.indexOf("Thread 1")).toBeLessThan(text.indexOf("Thread 2"));
    expect(text).not.toContain("the thread this request is about");
  });

  it("appends the attached list after the subject, or stands alone without one", async () => {
    const list = { id: "x", label: "This list", count: 1, markdown: () => "## My Reviews (1)\n\n| PR |\n| --- |\n| !42 |" };
    const both = await buildContextDocument(pr, list);
    expect(both.indexOf("# Pull request !42")).toBeLessThan(both.indexOf("## My Reviews (1)"));
    const only = await buildContextDocument(null, list);
    expect(only).toContain("## My Reviews (1)");
    expect(only).not.toContain("Pull request");
  });
});

describe("list Markdown", () => {
  it("escapes cells and caps the rows", () => {
    const rows = Array.from({ length: LIST_ROW_CAP + 5 }, (_, i) => [`!${i}`, "a|b\nc"]);
    const table = markdownTable(["PR", "Title"], rows);
    expect(table.split("\n")[0]).toBe("| PR | Title |");
    expect(table).toContain("| !0 | a\\|b c |");
    expect(table).not.toContain(`| !${LIST_ROW_CAP} |`);
    expect(table).toContain("(5 more rows not shown)");
  });

  it("writes the title, the notes on one line each, and the count", () => {
    const text = listMarkdown({ title: "Work item view: Bugs", notes: ["WIQL: SELECT\n  [System.Id]", null], headers: ["ID"], rows: [["#1"]] });
    expect(text.startsWith("## Work item view: Bugs (1)")).toBe(true);
    expect(text).toContain("- WIQL: SELECT [System.Id]");
  });
});
