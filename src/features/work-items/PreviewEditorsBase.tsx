import { Fragment, useEffect, useRef, useState } from "react";
import { commentAuthorInitials } from "./workItemHtml";

export function useCloseOnOutsidePointer<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target)) {
        return;
      }
      onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose, open]);

  return ref;
}

// Inline editor for the work item title shown in the preview header. Click (or
// keyboard-activate) the title to swap it for a single-line input; Enter saves,
// Escape cancels, and focus returns to the title button on close.
export function TitleEditor({
  current,
  onSubmit,
  pending,
}: {
  current: string;
  onSubmit: (title: string) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function open() {
    setDraft(current);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    buttonRef.current?.focus();
  }

  function save() {
    const title = draft.trim();
    if (!title || title === current.trim() || pending) {
      close();
      return;
    }
    onSubmit(title);
    setEditing(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={close}
        onKeyDown={(event) => {
          // Keep title editing keys from reaching the grid navigation handler.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        aria-label="Edit title"
        className="mt-0.5 w-full rounded border border-input bg-background px-1 py-0.5 text-sm font-semibold leading-5 text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={open}
      aria-label="Edit title"
      title={current}
      className="mt-0.5 line-clamp-2 w-full rounded px-1 text-left text-sm font-semibold leading-5 text-foreground hover:bg-secondary"
    >
      {current}
    </button>
  );
}

export function ReasonEditor({
  current,
  error,
  onOpenChange,
  onSubmit,
  open,
  pending,
  shortcut,
}: {
  current: string | null;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  open: boolean;
  pending: boolean;
  shortcut?: string;
}) {
  const [draft, setDraft] = useState(current ?? "");
  const editorRef = useCloseOnOutsidePointer<HTMLDivElement>(open, () =>
    onOpenChange(false),
  );

  useEffect(() => {
    if (open) setDraft(current ?? "");
  }, [current, open]);

  function save() {
    const reason = draft.trim();
    if (!reason || reason === (current ?? "").trim() || pending) return;
    onSubmit(reason);
  }

  return (
    <div ref={editorRef} className="relative min-w-0">
      <button
        type="button"
        aria-label="Change reason"
        aria-keyshortcuts={shortcut}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className="max-w-full truncate rounded px-1 text-left text-xs leading-4 text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        title={current ?? "—"}
      >
        {pending ? "Updating..." : (current ?? "—")}
      </button>
      {error && (
        <p className="mt-0.5 text-[10px] text-destructive">{error}</p>
      )}
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-lg">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            placeholder="Reason"
            className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim() || draft.trim() === (current ?? "").trim() || pending}
              onClick={save}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Marks the first case-insensitive occurrence of `query` in `text` so the
// candidate lists can show why an entry matched.
export function splitMatchSegments(
  text: string,
  query: string,
): { text: string; match: boolean }[] {
  const trimmed = query.trim();
  if (!trimmed) return [{ text, match: false }];
  const index = text.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) return [{ text, match: false }];
  const segments: { text: string; match: boolean }[] = [];
  if (index > 0) segments.push({ text: text.slice(0, index), match: false });
  segments.push({ text: text.slice(index, index + trimmed.length), match: true });
  if (index + trimmed.length < text.length) {
    segments.push({ text: text.slice(index + trimmed.length), match: false });
  }
  return segments;
}

export function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatchSegments(text, query).map((segment, index) =>
        segment.match ? (
          <b key={index} className="font-bold">
            {segment.text}
          </b>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

const CANDIDATE_AVATAR_CLASSES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

export function CandidateAvatar({ displayName }: { displayName: string }) {
  let hash = 0;
  for (const char of displayName) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  const colorClass = CANDIDATE_AVATAR_CLASSES[hash % CANDIDATE_AVATAR_CLASSES.length];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colorClass}`}
    >
      {commentAuthorInitials(displayName)}
    </span>
  );
}
