import type {
  AgentNote,
  AgentNoteItem,
  AgentNoteSummary,
  AgentNoteTarget,
  CreateAgentNoteInput,
  ReplyAgentNoteInput,
  UpdateAgentNoteInput,
} from "@/lib/azdoCommands";
import { noteNeedsYou } from "@/lib/azdoCommands";

// In-memory agent notes for browser demo mode, keyed by `${target}:${itemId}`.
// Seeded against the demo result HTML for work item 123 and PR 101 (see
// demoWorkItemResultPreview / demoReviewResultPreview).
const FOLDER = "C:\\reports\\azdo-work-items\\.to-agent-msg";
const PR_FOLDER = "C:\\reports\\azdo-reviews\\.to-agent-msg";

function seed(note: Partial<AgentNote> & Pick<AgentNote, "id" | "status" | "createdAt" | "body" | "filePath">): AgentNote {
  return {
    modifiedAt: note.createdAt,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
    quoteOffset: null,
    resultFile: null,
    resultHash: null,
    kind: null,
    resolved: null,
    replies: [],
    ...note,
  };
}

const demoNotes = new Map<string, AgentNote[]>([
  [
    "work-item:123",
    [
      seed({
        id: "20260925-174000.md",
        status: "done",
        createdAt: "2026-09-25T17:40:00+09:00",
        body: "Check the rollout against the main branch, not release.",
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
      }),
      seed({
        id: "20260926-091500.md",
        status: "open",
        createdAt: "2026-09-26T09:15:00+09:00",
        body: "Include the batch tenants too before concluding this.",
        quote: "No blocking issues found",
        resultFile: "123-result.html",
        filePath: `${FOLDER}\\wi-123\\20260926-091500.md`,
      }),
    ],
  ],
  [
    "pull-request:101",
    [
      seed({
        id: "20260926-101500.md",
        status: "open",
        createdAt: "2026-09-26T10:15:00+09:00",
        body: "Also check the limiter under concurrent requests from one client.",
        quote: "No blocking issues found",
        resultFile: "review-PR101.html",
        kind: "fix",
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
            body: "Load-tested 50 rps with **200-request bursts**: the limiter holds, p99 +3 ms. Should I also cover `PUT /limits`?",
          },
        ],
        filePath: `${PR_FOLDER}\\pr-101\\20260926-101500.md`,
      }),
    ],
  ],
]);
const demoTrash = new Map<string, AgentNote>();
let demoNoteSeq = 0;

const keyOf = (item: AgentNoteItem) => `${item.target}:${item.itemId}`;
const now = () => new Date().toISOString();

export function demoListAgentNotes(item: AgentNoteItem): AgentNote[] {
  return [...(demoNotes.get(keyOf(item)) ?? [])];
}

function save(item: AgentNoteItem, notes: AgentNote[]) {
  demoNotes.set(keyOf(item), notes);
}

function find(item: AgentNoteItem & { noteId: string }): AgentNote {
  const note = demoListAgentNotes(item).find((n) => n.id === item.noteId);
  if (!note) throw new Error(`note not found: ${item.noteId}`);
  return note;
}

function replace(item: AgentNoteItem, note: AgentNote): AgentNote {
  save(item, demoListAgentNotes(item).map((n) => (n.id === note.id ? note : n)));
  return note;
}

function pathFor(target: AgentNoteTarget, itemId: number, status: AgentNote["status"], id: string) {
  const root = target === "pull-request" ? `${PR_FOLDER}\\pr-${itemId}` : `${FOLDER}\\wi-${itemId}`;
  const sub = status === "done" ? "\\_done" : status === "draft" ? "\\_draft" : "";
  return `${root}${sub}\\${id}`;
}

export function demoCreateAgentNote(input: CreateAgentNoteInput): AgentNote {
  const body = input.body.trim();
  if (!body) throw new Error("note body is empty");
  const id = `demo-${Date.now()}-${++demoNoteSeq}.md`;
  const quote = input.quote?.trim() || null;
  const status = input.draft ? "draft" : "open";
  const note = seed({
    id,
    status,
    createdAt: now(),
    body,
    quote,
    quotePrefix: quote ? input.quotePrefix ?? null : null,
    quoteSuffix: quote ? input.quoteSuffix ?? null : null,
    quoteOffset: quote ? input.quoteOffset ?? null : null,
    resultFile: input.resultFile ?? null,
    resultHash: input.resultHash ?? null,
    kind: input.kind ?? null,
    filePath: pathFor(input.target, input.itemId, status, id),
  });
  save(input, [...demoListAgentNotes(input), note]);
  return note;
}

export function demoDeleteAgentNote(item: AgentNoteItem, noteId: string): void {
  const note = demoListAgentNotes(item).find((n) => n.id === noteId && n.status !== "done");
  if (!note) return;
  demoTrash.set(`${keyOf(item)}:${noteId}`, note);
  save(item, demoListAgentNotes(item).filter((n) => n !== note));
}

export function demoRestoreAgentNote(item: AgentNoteItem & { noteId: string }): void {
  const key = `${keyOf(item)}:${item.noteId}`;
  const note = demoTrash.get(key);
  if (!note) throw new Error(`deleted note not found: ${item.noteId}`);
  demoTrash.delete(key);
  save(item, [...demoListAgentNotes(item), note]);
}

export function demoReplyAgentNote(input: ReplyAgentNoteInput): AgentNote {
  const body = input.body.trim();
  if (!body) throw new Error("reply is empty");
  const current = find(input);
  return replace(input, {
    ...current,
    status: current.status === "draft" ? "draft" : "open",
    modifiedAt: now(),
    filePath: pathFor(input.target, input.itemId, current.status === "draft" ? "draft" : "open", current.id),
    replies: [...current.replies, { author: "user", createdAt: now(), body }],
  });
}

export function demoUpdateAgentNote(input: UpdateAgentNoteInput): AgentNote {
  const current = find(input);
  let next = { ...current, modifiedAt: now() };
  if (input.body != null) {
    if (current.status === "done" || current.replies.length) {
      throw new Error("the agent has already started on this note; reply instead");
    }
    const body = input.body.trim();
    if (!body) throw new Error("note body is empty");
    next = { ...next, body };
  }
  if (input.anchor) {
    next = { ...next, ...input.anchor, resultHash: input.anchor.resultHash ?? current.resultHash };
  }
  return replace(input, next);
}

export function demoSetAgentNoteStatus(
  input: AgentNoteItem & { noteId: string; status: "open" | "done" },
): AgentNote {
  const current = find(input);
  if (current.status === input.status) return current;
  return replace(input, {
    ...current,
    status: input.status,
    modifiedAt: now(),
    resolved: input.status === "done" ? "Resolved in DevDeck" : current.resolved,
    filePath: pathFor(input.target, input.itemId, input.status, current.id),
  });
}

export function demoSubmitAgentNoteDrafts(item: AgentNoteItem): number {
  let count = 0;
  save(
    item,
    demoListAgentNotes(item).map((n) => {
      if (n.status !== "draft") return n;
      count += 1;
      return { ...n, status: "open", filePath: pathFor(item.target, item.itemId, "open", n.id) };
    }),
  );
  return count;
}

const latest = (values: string[]) => values.sort()[values.length - 1] ?? null;

export function demoSummarizeAgentNotes(target: AgentNoteTarget): AgentNoteSummary[] {
  const summaries: AgentNoteSummary[] = [];
  for (const [key, notes] of demoNotes) {
    const [kind, id] = key.split(":");
    if (kind !== target || !notes.length) continue;
    const agentReplies = notes.flatMap((n) => n.replies).filter((r) => r.author !== "user");
    summaries.push({
      itemId: Number(id),
      open: notes.filter((n) => n.status === "open").length,
      needsYou: notes.filter(noteNeedsYou).length,
      drafts: notes.filter((n) => n.status === "draft").length,
      done: notes.filter((n) => n.status === "done").length,
      lastAgentReplyAt: latest(agentReplies.map((r) => r.createdAt)),
      lastModifiedAt: latest(notes.map((n) => n.modifiedAt ?? n.createdAt)),
    });
  }
  return summaries.sort((a, b) => a.itemId - b.itemId);
}
