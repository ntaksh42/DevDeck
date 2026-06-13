import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { type MentionCandidate } from "@/lib/azdoCommands";
import { MarkdownView } from "@/lib/markdown";

type Mode = "edit" | "preview";

/**
 * Reusable comment editor with a Write/Preview toggle and optional @mention
 * autocomplete. Owns its own draft so it can keep the text when a submit fails.
 * `onSubmit` is awaited; the draft is cleared only on success.
 */
export function CommentComposer({
  placeholder,
  submitLabel = "Comment",
  autoFocus = false,
  busy = false,
  onSubmit,
  onCancel,
  onSubmitted,
  mentionSearch,
}: {
  placeholder: string;
  submitLabel?: string;
  autoFocus?: boolean;
  busy?: boolean;
  onSubmit: (content: string) => Promise<void>;
  onCancel?: () => void;
  onSubmitted?: () => void;
  mentionSearch?: (query: string) => Promise<MentionCandidate[]>;
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("edit");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText("");
      setMode("edit");
      setMention(null);
      onSubmitted?.();
    } catch {
      // Keep the draft; the caller surfaces the error.
    } finally {
      setSubmitting(false);
    }
  }

  // Detect a `@token` immediately before the caret.
  function refreshMention(value: string, caret: number) {
    if (!mentionSearch) return;
    const before = value.slice(0, caret);
    const match = /(^|\s)@([\w.\-]*)$/.exec(before);
    if (match) {
      setMention({ start: caret - match[2].length - 1, query: match[2] });
    } else {
      setMention(null);
    }
  }

  const mentionQuery = mention?.query;
  useEffect(() => {
    if (mentionQuery == null || !mentionSearch) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      mentionSearch(mentionQuery)
        .then((list) => {
          if (!cancelled) {
            setCandidates(list.slice(0, 8));
            setActiveIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mentionQuery, mentionSearch]);

  function insertMention(candidate: MentionCandidate) {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const inserted = `@${candidate.displayName} `;
    setText(before + inserted + after);
    setMention(null);
    setCandidates([]);
    const pos = before.length + inserted.length;
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  const showMentions = mention != null && candidates.length > 0;

  return (
    <div className="rounded-md border border-border bg-white">
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1" role="tablist" aria-label="Comment editor mode">
        {(["edit", "preview"] as Mode[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            onClick={() => setMode(option)}
            className={`rounded px-2 py-px text-[11px] font-medium ${
              mode === option ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option === "edit" ? "Write" : "Preview"}
          </button>
        ))}
      </div>

      {mode === "edit" ? (
        <div className="relative">
          <textarea
            ref={textareaRef}
            autoFocus={autoFocus}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              refreshMention(event.target.value, event.target.selectionStart ?? event.target.value.length);
            }}
            onKeyUp={(event) => {
              const target = event.currentTarget;
              refreshMention(target.value, target.selectionStart ?? target.value.length);
            }}
            onKeyDown={(event) => {
              if (showMentions) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % candidates.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  insertMention(candidates[activeIndex]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
                return;
              }
              if (event.key === "Escape" && onCancel) {
                event.stopPropagation();
                onCancel();
              }
            }}
            rows={3}
            placeholder={placeholder}
            aria-label={placeholder}
            className="w-full resize-y bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
          />
          {showMentions ? (
            <ul className="absolute left-2 top-full z-20 max-h-40 w-64 overflow-auto rounded-md border border-border bg-white shadow-lg">
              {candidates.map((candidate, index) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertMention(candidate);
                    }}
                    className={`flex w-full flex-col px-2 py-1 text-left text-xs ${
                      index === activeIndex ? "bg-secondary" : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="font-medium">{candidate.displayName}</span>
                    {candidate.uniqueName ? (
                      <span className="text-[10px] text-muted-foreground">{candidate.uniqueName}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="min-h-[3rem] px-2 py-1.5 text-xs">
          {text.trim() ? (
            <MarkdownView text={text} className="text-foreground" />
          ) : (
            <span className="text-muted-foreground">Nothing to preview.</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-1 border-t border-border px-1.5 py-1">
        {submitting || busy ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border bg-white px-1.5 py-px text-[10px] hover:bg-secondary"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={!text.trim() || submitting || busy}
          onClick={submit}
          className="rounded border border-border bg-white px-2 py-px text-[11px] hover:bg-secondary disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
