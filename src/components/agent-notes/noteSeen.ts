import type { AgentNote, AgentNoteItem } from "@/lib/azdoCommands";

// Remembers, per note and per item, the newest agent reply the user has seen,
// so new agent replies can be marked unread. Browser storage only: losing it
// just shows replies as new again.

const KEY = "agentNotes.seen";
export const SEEN_CHANGED_EVENT = "azdodeck:agent-notes-seen";

type SeenMap = Record<string, string>;

function load(): SeenMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SeenMap;
  } catch {
    return {};
  }
}

function store(map: SeenMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Storage full or blocked: unread marks just reappear.
  }
  window.dispatchEvent(new Event(SEEN_CHANGED_EVENT));
}

const itemKey = (item: AgentNoteItem) => `${item.target}:${item.itemId}`;
const noteKey = (item: AgentNoteItem, noteId: string) => `${itemKey(item)}:${noteId}`;

/** Newest agent reply time on the note, if any. */
export function lastAgentReplyAt(note: AgentNote): string | null {
  for (let i = note.replies.length - 1; i >= 0; i--) {
    if (note.replies[i].author !== "user") return note.replies[i].createdAt || null;
  }
  return null;
}

export function isNoteUnread(item: AgentNoteItem, note: AgentNote): boolean {
  const latest = lastAgentReplyAt(note);
  return !!latest && latest > (load()[noteKey(item, note.id)] ?? "");
}

export function markNoteSeen(item: AgentNoteItem, note: AgentNote) {
  const latest = lastAgentReplyAt(note);
  const map = load();
  if (!latest || (map[noteKey(item, note.id)] ?? "") >= latest) return;
  map[noteKey(item, note.id)] = latest;
  store(map);
}

/** Whether the item has an agent reply newer than the last time its notes were opened. */
export function isItemUnread(item: AgentNoteItem, lastAgentReply: string | null): boolean {
  return !!lastAgentReply && lastAgentReply > (load()[itemKey(item)] ?? "");
}

export function markItemSeen(item: AgentNoteItem, lastAgentReply: string | null) {
  const map = load();
  if (!lastAgentReply || (map[itemKey(item)] ?? "") >= lastAgentReply) return;
  map[itemKey(item)] = lastAgentReply;
  store(map);
}
