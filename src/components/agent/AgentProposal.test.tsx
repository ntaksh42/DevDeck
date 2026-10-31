import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NoteReply } from "@/lib/azdoCommands";

const listPullRequestChanges = vi.fn();
const getPullRequestFileDiff = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listPullRequestChanges: (...args: unknown[]) => listPullRequestChanges(...args),
  getPullRequestFileDiff: (...args: unknown[]) => getPullRequestFileDiff(...args),
}));

import { AgentProposal } from "./AgentProposal";
import { proposalCodeContext } from "./useAgentProposals";

afterEach(() => {
  cleanup();
  listPullRequestChanges.mockReset();
  getPullRequestFileDiff.mockReset();
});

const lineReply: NoteReply = {
  author: "codex",
  createdAt: "2026-09-26T11:12:00+09:00",
  body: "Memoize this refresh.",
  kind: "post",
  postedAt: null,
  postedRef: null,
  filePath: "/src/app/dashboard.ts",
  line: 3,
};

function renderProposal(reply: NoteReply, withCode: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentProposal
        reply={reply}
        onPost={() => {}}
        busy={false}
        autoPost
        error={null}
        codeContext={
          withCode ? { organizationId: "org", projectId: "p1", repositoryId: "r1", pullRequestId: 101 } : null
        }
      />
    </QueryClientProvider>,
  );
}

describe("AgentProposal line comments", () => {
  it("shows the code around the line and says it needs approval", async () => {
    listPullRequestChanges.mockResolvedValue({
      baseCommitId: "a",
      targetCommitId: "b",
      files: [{ path: "/src/app/dashboard.ts", changeType: "edit", originalPath: null }],
    });
    getPullRequestFileDiff.mockResolvedValue({
      filePath: "/src/app/dashboard.ts",
      baseContent: null,
      targetContent: "one\ntwo\nthree\nfour",
      baseUnavailableReason: null,
      targetUnavailableReason: null,
    });
    const { container } = renderProposal(lineReply, true);

    expect(screen.getByText("Proposed line comment")).toBeTruthy();
    expect(screen.getByText("A line comment always needs your approval.")).toBeTruthy();
    expect(await screen.findByText("three")).toBeTruthy();
    expect(container.querySelector('[data-commented-line="true"]')?.textContent).toContain("three");
  });

  it("falls back to file:line when the pull request is not on screen", () => {
    renderProposal(lineReply, false);
    expect(screen.getByText("/src/app/dashboard.ts:3")).toBeTruthy();
    expect(listPullRequestChanges).not.toHaveBeenCalled();
  });
});

describe("proposalCodeContext", () => {
  const subject = {
    kind: "pull-request" as const,
    id: 101,
    title: "t",
    organizationId: "org",
    projectId: "p1",
    repositoryId: "r1",
    repositoryName: "repo",
    webUrl: null,
  };

  it("is the pull request on screen for its own notes only", () => {
    expect(proposalCodeContext(subject, { target: "pull-request", itemId: 101 })).toEqual({
      organizationId: "org",
      projectId: "p1",
      repositoryId: "r1",
      pullRequestId: 101,
    });
    expect(proposalCodeContext(subject, { target: "pull-request", itemId: 7 })).toBeNull();
    expect(proposalCodeContext(subject, { target: "work-item", itemId: 101 })).toBeNull();
    expect(proposalCodeContext(null, { target: "pull-request", itemId: 101 })).toBeNull();
  });
});
