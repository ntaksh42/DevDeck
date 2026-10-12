import { useEffect, useSyncExternalStore } from "react";
import type { AgentNoteItem } from "@/lib/azdoCommands";

// What the Agent panel is about: the item selected in the active view. Views
// publish their selection here; the panel reads it as the request's subject.

export type AgentSubject =
  | {
      kind: "pull-request";
      id: number;
      title: string;
      organizationId?: string;
      projectId: string;
      repositoryId: string;
      repositoryName: string;
      webUrl: string | null;
    }
  | {
      kind: "work-item";
      id: number;
      title: string;
      organizationId?: string;
      projectId: string;
      webUrl: string | null;
    }
  | {
      kind: "pipeline-run";
      id: number;
      title: string;
      organizationId?: string;
      projectId: string;
      webUrl: string | null;
    }
  | {
      kind: "wiki-page";
      title: string;
      organizationId?: string;
      projectId: string;
      projectName: string;
      wikiId: string;
      wikiName: string;
      pagePath: string;
      webUrl: string | null;
    };

let current: AgentSubject | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subjectKey(subject: AgentSubject | null): string {
  if (!subject) return "";
  return subject.kind === "wiki-page"
    ? `wiki-page:${subject.wikiId}:${subject.pagePath}`
    : `${subject.kind}:${subject.organizationId ?? ""}:${subject.id}`;
}

export function publishAgentSubject(subject: AgentSubject | null): void {
  if (subjectKey(subject) === subjectKey(current) && subject?.title === current?.title) return;
  current = subject;
  emit();
}

export function useAgentSubject(): AgentSubject | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/**
 * Publishes a view's selection while the view is mounted. Pass `null` when
 * nothing is selected; unmounting clears it unless another view took over.
 */
export function usePublishAgentSubject(subject: AgentSubject | null): void {
  const key = subjectKey(subject);
  const title = subject?.title;
  useEffect(() => {
    publishAgentSubject(subject);
    return () => {
      if (subjectKey(current) === key) publishAgentSubject(null);
    };
    // The key and title identify the subject; the object itself is rebuilt each render.
  }, [key, title]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Short label for chips and notifications. */
export function subjectLabel(subject: AgentSubject): string {
  switch (subject.kind) {
    case "pull-request":
      return `!${subject.id} ${subject.title}`.trim();
    case "work-item":
      return `#${subject.id} ${subject.title}`.trim();
    case "pipeline-run":
      return `Run ${subject.title}`;
    case "wiki-page":
      return `Wiki ${subject.pagePath}`;
  }
}

/** The one-line `context` written into the note's front-matter. */
export function contextLine(subject: AgentSubject): string {
  const kind = {
    "pull-request": "Pull request",
    "work-item": "Work item",
    "pipeline-run": "Pipeline run",
    "wiki-page": "Wiki page",
  }[subject.kind];
  return [kind, subjectLabel(subject), subject.webUrl].filter(Boolean).join(" · ");
}

/** Pull requests and work items keep their notes per item; the rest are requests. */
export function noteItemOf(subject: AgentSubject | null): AgentNoteItem | null {
  if (subject?.kind === "pull-request") return { target: "pull-request", itemId: subject.id };
  if (subject?.kind === "work-item") return { target: "work-item", itemId: subject.id };
  return null;
}

// ── Opening the panel from anywhere ────────────────────────────────────────

export const OPEN_AGENT_PANEL_EVENT = "devdeck:open-agent-panel";

/** Text quoted from a result HTML, which the new note is about. */
export type AgentQuote = {
  quote: string;
  prefix: string | null;
  suffix: string | null;
  offset: number | null;
  resultFile: string | null;
  resultHash: string | null;
};

export type OpenAgentPanelDetail = {
  /** Start a note about this quoted text (from the Result panel). */
  quote?: AgentQuote;
  /** Select and expand this note of the subject item (a pin in the result). */
  noteId?: string;
  /** Pin this subject instead of following the selection. */
  subject?: AgentSubject | null;
  /** Show this request (an `ask` conversation) expanded. */
  askId?: number;
  /** Start answering the conversation that waits for the user. */
  reply?: boolean;
};

export const TOGGLE_AGENT_PANEL_EVENT = "devdeck:toggle-agent-panel";

export function toggleAgentPanel(): void {
  window.dispatchEvent(new Event(TOGGLE_AGENT_PANEL_EVENT));
}

export function openAgentPanel(detail: OpenAgentPanelDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenAgentPanelDetail>(OPEN_AGENT_PANEL_EVENT, { detail }));
}

// ── Result panel requests from the Agent panel ─────────────────────────────

/** Scroll the result to a note's quote, or to the change the agent marked for it. */
export const REVEAL_NOTE_EVENT = "devdeck:agent-note-reveal";
/** Pick a new quote for a note: its next selection in the result replaces the old one. */
export const REATTACH_NOTE_EVENT = "devdeck:agent-note-reattach";

export type NoteRequestDetail = AgentNoteItem & { noteId: string };

export function requestNoteReveal(detail: NoteRequestDetail): void {
  window.dispatchEvent(new CustomEvent<NoteRequestDetail>(REVEAL_NOTE_EVENT, { detail }));
}

export function requestNoteReattach(detail: NoteRequestDetail): void {
  window.dispatchEvent(new CustomEvent<NoteRequestDetail>(REATTACH_NOTE_EVENT, { detail }));
}
