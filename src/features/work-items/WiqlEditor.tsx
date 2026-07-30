import { useEffect, useId, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Maximize2, Minimize2, WandSparkles } from 'lucide-react';
import { formatWiql, tokenizeWiql, type WiqlCompletion } from './workItemViewsHelpers';

// The overlay and the textarea must resolve to the exact same text metrics, or
// the highlighted tokens drift away from the characters the user is typing.
const WIQL_TEXT_CLASSES = "px-3 py-2 font-mono text-xs leading-5 tracking-normal whitespace-pre-wrap break-words";

const TOKEN_CLASSES: Record<string, string> = {
  keyword: "font-semibold text-sky-700 dark:text-sky-300",
  field: "text-purple-700 dark:text-purple-300",
  macro: "font-semibold text-amber-700 dark:text-amber-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-emerald-700 dark:text-emerald-300",
  plain: "",
};

export type WiqlEditorProps = {
  value: string;
  onChange: (value: string, cursor: number) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onCursorChange: (cursor: number) => void;
  completionsOpen: boolean;
  setCompletionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  completions: WiqlCompletion[];
  activeCompletionIndex: number;
  setActiveCompletionIndex: React.Dispatch<React.SetStateAction<number>>;
  onApplyCompletion: (completion: WiqlCompletion) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export function WiqlEditor({
  value,
  onChange,
  textareaRef,
  onCursorChange,
  completionsOpen,
  setCompletionsOpen,
  completions,
  activeCompletionIndex,
  setActiveCompletionIndex,
  onApplyCompletion,
  expanded,
  onExpandedChange,
}: WiqlEditorProps) {
  const listId = useId();
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const tokens = useMemo(() => tokenizeWiql(value), [value]);
  const listOpen = completionsOpen && completions.length > 0;
  const activeIndex = Math.min(activeCompletionIndex, Math.max(0, completions.length - 1));
  const activeOptionId = listOpen ? `${listId}-option-${activeIndex}` : undefined;

  // Keep the highlight layer aligned while the textarea scrolls internally.
  function syncScroll() {
    const highlight = highlightRef.current;
    const textarea = textareaRef.current;
    if (!highlight || !textarea) return;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }

  useEffect(() => {
    syncScroll();
  }, [value, expanded]);

  useEffect(() => {
    if (!listOpen) return;
    const option = document.getElementById(`${listId}-option-${activeIndex}`);
    // jsdom does not implement scrollIntoView, and keeping the active option in
    // view is presentational, so skip it rather than fail.
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, listId, listOpen]);

  function applyFormatting() {
    const formatted = formatWiql(value);
    if (!formatted || formatted === value) return;
    onChange(formatted, formatted.length);
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(formatted.length, formatted.length);
    }, 0);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.ctrlKey && event.key === " ") {
      event.preventDefault();
      setActiveCompletionIndex(0);
      setCompletionsOpen((open) => !open);
      return;
    }

    if (event.shiftKey && event.altKey && (event.key === "F" || event.key === "f")) {
      event.preventDefault();
      applyFormatting();
      return;
    }

    if (listOpen) {
      // Arrow/Enter must not reach the dialog or the grid behind it while the
      // completion list owns the keyboard.
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActiveCompletionIndex((index) => (index + 1) % completions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActiveCompletionIndex(
          (index) => (index - 1 + completions.length) % completions.length,
        );
        return;
      }
      if (event.key === "Home" && event.ctrlKey) {
        event.preventDefault();
        setActiveCompletionIndex(0);
        return;
      }
      if (event.key === "End" && event.ctrlKey) {
        event.preventDefault();
        setActiveCompletionIndex(completions.length - 1);
        return;
      }
      // Ctrl/Cmd+Enter submits the dialog, so it must not be swallowed as a
      // completion pick even while the list is open.
      if ((event.key === "Enter" && !event.ctrlKey && !event.metaKey) || event.key === "Tab") {
        const completion = completions[activeIndex];
        if (completion) {
          event.preventDefault();
          event.stopPropagation();
          onApplyCompletion(completion);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setCompletionsOpen(false);
        return;
      }
    }

    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      onExpandedChange(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="view-wiql-input">
          WIQL
        </label>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={applyFormatting}
            title="Reformat the query (Shift+Alt+F)"
            aria-keyshortcuts="Shift+Alt+F"
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium hover:bg-secondary"
          >
            <WandSparkles className="h-3 w-3" aria-hidden="true" />
            Format
          </button>
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            aria-pressed={expanded}
            title={expanded ? "Shrink the editor" : "Expand the editor"}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium hover:bg-secondary"
          >
            {expanded ? (
              <Minimize2 className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
            )}
            {expanded ? "Shrink" : "Expand"}
          </button>
        </span>
      </div>

      <div className="relative">
        {/* Painted underneath the transparent textarea text. */}
        <pre
          ref={highlightRef}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 m-0 overflow-hidden rounded-md border border-transparent ${WIQL_TEXT_CLASSES}`}
        >
          {tokens.map((token, index) => (
            <span key={index} className={TOKEN_CLASSES[token.kind]}>
              {token.text}
            </span>
          ))}
          {/* Trailing newline keeps the last line visible while scrolling. */}
          {"\n"}
        </pre>
        <textarea
          ref={textareaRef}
          id="view-wiql-input"
          value={value}
          onChange={(event) => {
            onChange(event.target.value, event.target.selectionStart);
            setActiveCompletionIndex(0);
            setCompletionsOpen(true);
          }}
          onScroll={syncScroll}
          onClick={(event) => onCursorChange(event.currentTarget.selectionStart)}
          onKeyUp={(event) => onCursorChange(event.currentTarget.selectionStart)}
          onFocus={(event) => {
            onCursorChange(event.currentTarget.selectionStart);
            setCompletionsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          rows={expanded ? 18 : 7}
          spellCheck={false}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-describedby="view-wiql-hint"
          className={`relative w-full resize-y rounded-md border border-input bg-transparent text-transparent caret-foreground outline-none focus:ring-2 focus:ring-ring ${WIQL_TEXT_CLASSES} ${
            expanded ? "min-h-[320px]" : "min-h-[120px]"
          }`}
        />
      </div>

      {listOpen ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="WIQL completions"
          className="max-h-40 overflow-auto rounded-md border border-border bg-muted p-1"
        >
          {completions.map((completion, index) => (
            <li key={`${completion.label}:${completion.value}`}>
              <button
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveCompletionIndex(index)}
                onClick={() => onApplyCompletion(completion)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] ${
                  index === activeIndex
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary"
                }`}
              >
                <span className="font-mono">{completion.label}</span>
                <span
                  className={`ml-auto truncate ${
                    index === activeIndex ? "text-primary-foreground/80" : "text-muted-foreground"
                  }`}
                >
                  {completion.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p id="view-wiql-hint" className="text-[10px] text-muted-foreground">
        Ctrl+Space completions · ↑↓ select · Enter/Tab apply · Esc close
      </p>
    </div>
  );
}
