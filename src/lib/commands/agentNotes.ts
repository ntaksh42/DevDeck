import { z } from "zod";
import { invokeCommand } from "./runtime";

// Notes for the external AI agent that investigates work items (and, later,
// reviews pull requests). The backend stores each note as a Markdown file under
// the matching result folder (`.to-agent-msg/wi-{id}/` or `pr-{id}/`); the agent
// moves handled notes into `_done/`.

export type AgentNoteTarget = "work-item" | "pull-request";

const agentNoteSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "done"]),
  createdAt: z.string(),
  body: z.string(),
  quote: z.string().nullable(),
  quotePrefix: z.string().nullable(),
  quoteSuffix: z.string().nullable(),
  resultFile: z.string().nullable(),
  resolved: z.string().nullable(),
  filePath: z.string(),
});

export type AgentNote = z.infer<typeof agentNoteSchema>;

export type AgentNoteItem = { target: AgentNoteTarget; itemId: number };

export type CreateAgentNoteInput = AgentNoteItem & {
  body: string;
  quote?: string | null;
  quotePrefix?: string | null;
  quoteSuffix?: string | null;
  resultFile?: string | null;
};

export async function listAgentNotes(input: AgentNoteItem): Promise<AgentNote[]> {
  const result = await invokeCommand("list_agent_notes", { input });
  return z.array(agentNoteSchema).parse(result);
}

export async function createAgentNote(input: CreateAgentNoteInput): Promise<AgentNote> {
  const result = await invokeCommand("create_agent_note", { input });
  return agentNoteSchema.parse(result);
}

export async function deleteAgentNote(
  input: AgentNoteItem & { noteId: string },
): Promise<void> {
  await invokeCommand("delete_agent_note", { input });
}
