import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { type MentionCandidate } from "@/lib/azdoCommands";
import {
  activeMentionAt,
  addSelectedMention,
  mentionTokenDeletionStart,
  renderAzureMentionMarkdown,
  type SelectedMention,
} from "@/features/work-items/workItemMentions";
import {
  PULL_REQUEST_COMMENT_HEIGHT_STORAGE_KEY,
  usePersistedTextareaHeight,
} from "@/lib/usePersistedTextareaHeight";

/**
 * Reusable comment editor with optional @mention autocomplete. Owns its own
 * draft so it can keep the text when a submit fails. `onSubmit` is awaited; the
 * draft is cleared only on success.
 */
export function CommentComposer({
  placeholder,
  submitLabel = "Comment",
  initialValue = "",
  autoFocus = false,
  busy = false,
  onSubmit,
  onCancel,
  onSubmitted,
  mentionSearch,
}: {
  placeholder: string;
  submitLabel?: string;
  initialValue?: string;
  autoFocus?: boolean;
  busy?: boolean;
  onSubmit: (content: string) => Promise<void>;
  onCancel?: () => void;
  onSubmitted?: () => void;
  mentionSearch?: (query: string) => Promise<MentionCandidate[]>;
}) {
  const [text, setText] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = usePersistedTextareaHeight(
    PULL_REQUEST_COMMENT_HEIGHT_STORAGE_KEY,
  );

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Mentions chosen from the picker, kept so their plain "@Name" text can be
  // converted back to the "@<guid>" markdown Azure DevOps needs to create a
  // real (notifying) mention instead of leaving inert text.
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    const content = renderAzureMentionMarkdown(trimmed, selectedMentions);
    setSubmitting(true);
    try {
      await onSubmit(content);
      setText("");
      setMention(null);
      setSelectedMentions([]);
      onSubmitted?.();
    } catch {
      // Keep the draft; the caller surfaces the error.
    } finally {
      setSubmitting(false);
    }
  }

  // Detect a `@token` immediately before the caret. Shared with the work item
  // composer so non-ASCII display names (e.g. Japanese names) also trigger
  // the picker.
  function refreshMention(value: string, caret: number) {
    if (!mentionSearch) return;
    setMention(activeMentionAt(value, caret));
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
    setSelectedMentions((current) => addSelectedMention(current, candidate));
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
    <div className="rounded-md border border-border bg-card">
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
              if (
                event.key === "Backspace" &&
                event.currentTarget.selectionStart === event.currentTarget.selectionEnd
              ) {
                const textarea = event.currentTarget;
                const cursor = textarea.selectionStart;
                const start = mentionTokenDeletionStart(
                  text,
                  cursor,
                  selectedMentions.map((selected) => selected.displayName),
                );
                if (start !== null) {
                  event.preventDefault();
                  const next = text.slice(0, start) + text.slice(cursor);
                  setText(next);
                  refreshMention(next, start);
                  window.setTimeout(() => textarea.setSelectionRange(start, start), 0);
                  return;
                }
              }
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
            <ul className="absolute left-2 top-full z-20 max-h-40 w-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
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

      <div className="flex items-center justify-end gap-1 border-t border-border px-1.5 py-1">
        {submitting || busy ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border bg-card px-1.5 py-px text-[10px] hover:bg-secondary"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={!text.trim() || submitting || busy}
          onClick={submit}
          className="rounded border border-border bg-card px-2 py-px text-[11px] hover:bg-secondary disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
