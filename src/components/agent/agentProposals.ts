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

/** Links and @mentions are never posted on their own (the backend refuses them too). */
export function needsApproval(reply: NoteReply): boolean {
  return /https?:\/\/|@/.test(reply.body);
}
