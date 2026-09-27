import { z } from "zod";
import { invokeCommand } from "./runtime";

// Notes for the external AI agent that investigates work items and reviews
// pull requests. The backend stores each note as a Markdown file under
// the matching result folder (`.to-agent-msg/wi-{id}/` or `pr-{id}/`); the agent
// moves handled notes into `_done/`. Unsent drafts live in `_draft/`.

export type AgentNoteTarget = "work-item" | "pull-request";

export type AgentNoteKind = "fix" | "question" | "redo";

const noteReplySchema = z.object({
  author: z.string(),
  createdAt: z.string(),
  body: z.string(),
});

const agentNoteSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "done", "draft"]),
  createdAt: z.string(),
  modifiedAt: z.string().nullable().optional().default(null),
  body: z.string(),
  quote: z.string().nullable(),
  quotePrefix: z.string().nullable(),
  quoteSuffix: z.string().nullable(),
  quoteOffset: z.number().nullable().optional().default(null),
  resultFile: z.string().nullable(),
  resultHash: z.string().nullable().optional().default(null),
  kind: z.string().nullable().optional().default(null),
  resolved: z.string().nullable(),
  replies: z.array(noteReplySchema),
  filePath: z.string(),
});

export type AgentNote = z.infer<typeof agentNoteSchema>;

/** Waiting for the user: the agent replied last (a question, or it could not finish). */
export function noteNeedsYou(note: AgentNote): boolean {
  const last = note.replies[note.replies.length - 1];
  return note.status === "open" && !!last && last.author !== "user";
}

export type AgentNoteItem = { target: AgentNoteTarget; itemId: number };

export type CreateAgentNoteInput = AgentNoteItem & {
  body: string;
  quote?: string | null;
  quotePrefix?: string | null;
  quoteSuffix?: string | null;
  quoteOffset?: number | null;
  resultFile?: string | null;
  resultHash?: string | null;
  kind?: AgentNoteKind | null;
  draft?: boolean;
};

export async function listAgentNotes(input: AgentNoteItem): Promise<AgentNote[]> {
  const result = await invokeCommand("list_agent_notes", { input });
  return z.array(agentNoteSchema).parse(result);
}

export async function createAgentNote(input: CreateAgentNoteInput): Promise<AgentNote> {
  const result = await invokeCommand("create_agent_note", { input });
  return agentNoteSchema.parse(result);
}

/** Moves an open or draft note to the trash; `restoreAgentNote` undoes it. */
export async function deleteAgentNote(
  input: AgentNoteItem & { noteId: string },
): Promise<void> {
  await invokeCommand("delete_agent_note", { input });
}

export async function restoreAgentNote(
  input: AgentNoteItem & { noteId: string; status: "open" | "draft" },
): Promise<void> {
  await invokeCommand("restore_agent_note", { input });
}

export type ReplyAgentNoteInput = AgentNoteItem & { noteId: string; body: string };

/** Appends the user's reply to a note's thread; a done note is reopened. */
export async function replyAgentNote(input: ReplyAgentNoteInput): Promise<AgentNote> {
  const result = await invokeCommand("reply_agent_note", { input });
  return agentNoteSchema.parse(result);
}

export type NoteAnchorInput = {
  quote: string;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  quoteOffset: number | null;
  resultHash: string | null;
};

export type UpdateAgentNoteInput = AgentNoteItem & {
  noteId: string;
  /** Only before the agent has replied. */
  body?: string | null;
  anchor?: NoteAnchorInput | null;
};

export async function updateAgentNote(input: UpdateAgentNoteInput): Promise<AgentNote> {
  const result = await invokeCommand("update_agent_note", { input });
  return agentNoteSchema.parse(result);
}

/** Resolves (`done`) or reopens (`open`) a note from DevDeck. */
export async function setAgentNoteStatus(
  input: AgentNoteItem & { noteId: string; status: "open" | "done" },
): Promise<AgentNote> {
  const result = await invokeCommand("set_agent_note_status", { input });
  return agentNoteSchema.parse(result);
}

/** Moves every draft of the item into the open folder. Returns how many. */
export async function submitAgentNoteDrafts(input: AgentNoteItem): Promise<number> {
  const result = await invokeCommand("submit_agent_note_drafts", { input });
  return z.number().parse(result);
}

const agentNoteSummarySchema = z.object({
  itemId: z.number(),
  open: z.number(),
  needsYou: z.number(),
  drafts: z.number(),
  done: z.number(),
  lastAgentReplyAt: z.string().nullable(),
  lastModifiedAt: z.string().nullable(),
});

export type AgentNoteSummary = z.infer<typeof agentNoteSummarySchema>;

/** Note counts for every item with notes under one result folder. */
export async function summarizeAgentNotes(input: {
  target: AgentNoteTarget;
}): Promise<AgentNoteSummary[]> {
  const result = await invokeCommand("summarize_agent_notes", { input });
  return z.array(agentNoteSummarySchema).parse(result);
}

/** Starts the agent command from Settings for one item's notes. */
export async function runAgent(input: AgentNoteItem): Promise<void> {
  await invokeCommand("run_agent", { input });
}
