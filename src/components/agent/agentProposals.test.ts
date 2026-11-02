import { describe, expect, it } from "vitest";
import type { AgentNote, NoteReply } from "@/lib/azdoCommands";
import { approvalReason, isLineProposal, needsApproval, pendingProposals, proposalSignature } from "./agentProposals";

const reply = (over: Partial<NoteReply> = {}): NoteReply => ({
  author: "claude",
  createdAt: "2026-10-01T10:00:00+09:00",
  body: "Looks good",
  kind: "post",
  postedAt: null,
  postedRef: null,
  ...over,
});

const note = (replies: NoteReply[], status: AgentNote["status"] = "open"): AgentNote => ({
  id: "n.md",
  status,
  createdAt: "2026-10-01T09:00:00+09:00",
  modifiedAt: null,
  body: "review",
  quote: null,
  quotePrefix: null,
  quoteSuffix: null,
  quoteOffset: null,
  resultFile: null,
  resultHash: null,
  kind: null,
  context: null,
  contextFile: null,
  resolved: null,
  replies,
  filePath: "n.md",
});

describe("agent comment proposals", () => {
  it("signs for Claude and Codex only", () => {
    expect(proposalSignature("claude")).toBe("— 🤖 Posted by Claude (via DevDeck)");
    expect(proposalSignature("codex")).toBe("— 🤖 Posted by Codex (via DevDeck)");
    expect(proposalSignature("user")).toBeNull();
  });

  it("lists unposted proposals by their index among the replies", () => {
    const n = note([
      reply({ kind: "reply" }),
      reply({ body: "first" }),
      reply({ body: "done", postedAt: "2026-10-01T10:05:00+09:00" }),
      reply({ body: "second" }),
      reply({ author: "user", body: "not an agent" }),
    ]);
    expect(pendingProposals(n).map((p) => p.index)).toEqual([1, 3]);
  });

  it("ignores drafts", () => {
    expect(pendingProposals(note([reply()], "draft"))).toEqual([]);
  });

  it("asks for approval when a comment has a link or mention", () => {
    expect(needsApproval(reply({ body: "see https://example.com" }))).toBe(true);
    expect(needsApproval(reply({ body: "@alice please check" }))).toBe(true);
    expect(needsApproval(reply({ body: "Nice change, #123 covers it" }))).toBe(false);
  });

  it("always asks for approval of a line comment", () => {
    const line = reply({ filePath: "/src/a.ts", line: 7 });
    expect(isLineProposal(line)).toBe(true);
    expect(needsApproval(line)).toBe(true);
    expect(approvalReason(line)).toBe("A line comment always needs your approval.");
    expect(isLineProposal(reply())).toBe(false);
    expect(approvalReason(reply())).toBeNull();
  });
});
