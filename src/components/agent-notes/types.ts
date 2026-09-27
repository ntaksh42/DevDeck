import type { AgentNote } from "@/lib/azdoCommands";
import type { QuoteAnchor, TextIndex } from "./resultAnchoring";

/** Parsed state of the loaded result iframe. Replaced on every load. */
export type FrameState = {
  doc: Document;
  index: TextIndex;
  blocks: HTMLElement[];
};

/** How a note shows up in the list and as a pin: waiting for the user, open, or an unsent draft. */
export type NoteTone = "needs" | "open" | "draft";

/** An open or draft note with its location in the current result, if it still resolves. */
export type NoteAnchor = {
  note: AgentNote;
  tone: NoteTone;
  /** Display number shared by the list and the gutter pin; null when unanchored. */
  num: number | null;
  range: Range | null;
};

export type CommentRequest = QuoteAnchor & {
  range: Range;
  origin: "block" | "mouse";
};
