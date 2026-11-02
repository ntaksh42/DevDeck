import type { AgentNote, NoteReply } from "@/lib/azdoCommands";

// Comments an agent proposes to leave on the work item / pull request. The
// agent writes them into the note; DevDeck signs and posts them.

const AGENT_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex" };

/** The signature DevDeck appends to a posted comment (the backend adds the real one). */
export function proposalSignature(author: string): string | null {
  const name = AGENT_NAMES[author];
  return name ? `— 🤖 Posted by ${name} (via DevDeck)` : null;
}

export type Proposal = { index: number; reply: NoteReply };

/** Proposals not posted yet, oldest first, from agents DevDeck can sign for. */
export function pendingProposals(note: AgentNote): Proposal[] {
  if (note.status === "draft") return [];
  return note.replies
    .map((reply, index) => ({ index, reply }))
    .filter(({ reply }) => reply.kind === "post" && !reply.postedAt && proposalSignature(reply.author) !== null);
}

/** A proposal about one line of a pull request file (posted as a new thread there). */
export function isLineProposal(reply: NoteReply): boolean {
  return !!reply.filePath || reply.line != null;
}

/**
 * Why a proposal is never posted on its own (the backend refuses these too):
 * links and @mentions, and line comments. Null when it may be posted automatically.
 */
export function approvalReason(reply: NoteReply): string | null {
  if (isLineProposal(reply)) return "A line comment always needs your approval.";
  if (/https?:\/\/|@/.test(reply.body)) return "Has a link or @mention, so it needs your approval.";
  return null;
}

export function needsApproval(reply: NoteReply): boolean {
  return approvalReason(reply) !== null;
}
