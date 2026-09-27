import type {
  AgentNote,
  AgentNoteItem,
  CreateAgentNoteInput,
  ReplyAgentNoteInput,
} from "@/lib/azdoCommands";

// In-memory agent notes for browser demo mode, keyed by `${target}:${itemId}`.
// Seeded against the demo result HTML for work item 123 and PR 101 (see
// demoWorkItemResultPreview / demoReviewResultPreview).
const FOLDER = "C:\\reports\\azdo-work-items\\.to-agent-msg";
const PR_FOLDER = "C:\\reports\\azdo-reviews\\.to-agent-msg";
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
        replies: [
          {
            author: "claude",
            createdAt: "2026-09-25T18:05:00+09:00",
            body: "Re-ran the analysis on main @ 8c1d2e4 and commented on #123.",
          },
        ],
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
        replies: [],
        filePath: `${FOLDER}\\wi-123\\20260926-091500.md`,
      },
    ],
  ],
  [
    "pull-request:101",
    [
      {
        id: "20260926-101500.md",
        status: "open",
        createdAt: "2026-09-26T10:15:00+09:00",
        body: "Also check the limiter under concurrent requests from one client.",
        quote: "No blocking issues found",
        quotePrefix: null,
        quoteSuffix: null,
        resultFile: "review-PR101.html",
        resolved: null,
        replies: [
          {
            author: "codex",
            createdAt: "2026-09-26T10:40:00+09:00",
            body: "How many concurrent requests should I assume? The service limit is 50 rps per client.",
          },
          {
            author: "user",
            createdAt: "2026-09-26T10:45:00+09:00",
            body: "Use 50 rps with bursts of 200.",
          },
          {
            author: "codex",
            createdAt: "2026-09-26T11:10:00+09:00",
            body: "Load-tested 50 rps with 200-request bursts: the limiter holds, p99 +3 ms. Added to the result.",
          },
        ],
        filePath: `${PR_FOLDER}\\pr-101\\20260926-101500.md`,
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
    replies: [],
    filePath: input.target === "pull-request"
      ? `${PR_FOLDER}\\pr-${input.itemId}\\${id}`
      : `${FOLDER}\\wi-${input.itemId}\\${id}`,
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

export function demoReplyAgentNote(input: ReplyAgentNoteInput): AgentNote {
  const body = input.body.trim();
  if (!body) throw new Error("reply is empty");
  const current = demoListAgentNotes(input).find((n) => n.id === input.noteId);
  if (!current) throw new Error(`note not found: ${input.noteId}`);
  const note: AgentNote = {
    ...current,
    status: "open",
    filePath: current.filePath.replace("\\_done\\", "\\"),
    replies: [...current.replies, { author: "user", createdAt: new Date().toISOString(), body }],
  };
  demoNotes.set(
    keyOf(input),
    demoListAgentNotes(input).map((n) => (n.id === note.id ? note : n)),
  );
  return note;
}
