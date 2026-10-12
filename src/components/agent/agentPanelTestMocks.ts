import { vi } from "vitest";
import type { AgentAsk, AgentNote } from "@/lib/azdoCommands";

export function note(id: string, body: string, extra: Partial<AgentNote> = {}): AgentNote {
  return {
    id,
    status: "open",
    createdAt: "2026-10-11T09:00:00+09:00",
    modifiedAt: null,
    body,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
    quoteOffset: null,
    resultFile: null,
    resultHash: null,
    kind: "investigate",
    context: null,
    contextFile: null,
    resolved: null,
    replies: [],
    filePath: `C:/notes/${id}`,
    ...extra,
  };
}

export const asks: AgentAsk[] = [
  {
    itemId: 20261011090000,
    lastModifiedAt: "2026-10-11T09:06:00+09:00",
    notes: [
      note("a.md", "Why did run 412 fail?", {
        replies: [{ author: "claude", createdAt: "2026-10-11T09:06:00+09:00", body: "Which culture should the test pin?" }],
      }),
    ],
  },
  {
    itemId: 20261010080000,
    lastModifiedAt: "2026-10-10T08:00:00+09:00",
    notes: [note("b.md", "Summarize last week", { status: "done", kind: "summarize", resolved: "Summarized" })],
  },
];

export const createAgentNote = vi.fn(async (input: unknown) => note("new.md", (input as { body: string }).body));
export const runAgent = vi.fn(async (_input: unknown) => {});
export const replyAgentNote = vi.fn(async (_input: unknown) => note("a.md", "x"));
export const setAgentNoteStatus = vi.fn(async (_input: unknown) => note("a.md", "x"));
// The asks the list command returns; deleting a note removes it from `state.asks`.
export const state = { asks };
export const deleteAgentNote = vi.fn(async (input: unknown) => {
  const { noteId } = input as { noteId: string };
  state.asks = state.asks.map((ask) => ({ ...ask, notes: ask.notes.filter((n) => n.id !== noteId) })).filter((ask) => ask.notes.length);
});
