import type { AgentNote, AgentNoteItem, CreateAgentNoteInput } from "@/lib/azdoCommands";

// In-memory agent notes for browser demo mode, keyed by `${target}:${itemId}`.
// Seeded against the demo result HTML for work item 123 (see demoWorkItemResultPreview).
const FOLDER = "C:\\reports\\azdo-work-items\\.to-agent-msg";
const demoNotes = new Map<string, AgentNote[]>([
  [
    "work-item:123",
    [
      {
        id: "20260925-174000.md",
        status: "done",
        createdAt: "2026-09-25T17:40:00+09:00",
        body: "Check the rollout against the main branch, not release.",
        quote: null,
        quotePrefix: null,
        quoteSuffix: null,
        resultFile: "123-result.html",
        resolved: "Commented on #123: re-ran the analysis on main.",
        filePath: `${FOLDER}\\wi-123\\_done\\20260925-174000.md`,
      },
      {
        id: "20260926-091500.md",
        status: "open",
        createdAt: "2026-09-26T09:15:00+09:00",
        body: "Include the batch tenants too before concluding this.",
        quote: "No blocking issues found",
        quotePrefix: null,
        quoteSuffix: null,
        resultFile: "123-result.html",
        resolved: null,
        filePath: `${FOLDER}\\wi-123\\20260926-091500.md`,
      },
    ],
  ],
]);
let demoNoteSeq = 0;

const keyOf = (item: AgentNoteItem) => `${item.target}:${item.itemId}`;

export function demoListAgentNotes(item: AgentNoteItem): AgentNote[] {
  return [...(demoNotes.get(keyOf(item)) ?? [])];
}

export function demoCreateAgentNote(input: CreateAgentNoteInput): AgentNote {
  const body = input.body.trim();
  if (!body) throw new Error("note body is empty");
  const id = `demo-${Date.now()}-${++demoNoteSeq}.md`;
  const quote = input.quote?.trim() || null;
  const note: AgentNote = {
    id,
    status: "open",
    createdAt: new Date().toISOString(),
    body,
    quote,
    quotePrefix: quote ? input.quotePrefix ?? null : null,
    quoteSuffix: quote ? input.quoteSuffix ?? null : null,
    resultFile: input.resultFile ?? null,
    resolved: null,
    filePath: `${FOLDER}\\${input.target === "pull-request" ? "pr" : "wi"}-${input.itemId}\\${id}`,
  };
  demoNotes.set(keyOf(input), [...demoListAgentNotes(input), note]);
  return note;
}

export function demoDeleteAgentNote(item: AgentNoteItem, noteId: string): void {
  demoNotes.set(
    keyOf(item),
    demoListAgentNotes(item).filter((n) => n.id !== noteId || n.status !== "open"),
  );
}
