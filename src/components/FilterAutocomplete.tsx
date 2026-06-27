import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Search, X } from "lucide-react";

const MAX_SUGGESTIONS = 8;

/**
 * Distinct pool values that contain the typed text (case-insensitive),
 * excluding an exact match, capped for the dropdown. Pure for unit testing.
 */
export function filterSuggestions(pool: string[], value: string): string[] {
  const term = value.trim().toLowerCase();
  if (!term) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of pool) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower === term) continue;
    if (!lower.includes(term)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/**
 * A free-text filter input with a keyboard-navigable value-suggestion dropdown
 * (issue #310). Suggestions are derived from `suggestionPool` (e.g. the repo /
 * author values present in the loaded rows). Typing still filters live via
 * `onChange`; picking a suggestion replaces the value. Arrow keys move the
 * highlight, Enter accepts, Escape closes the dropdown (and is contained so the
 * underlying grid does not also react), and focus stays in the input.
 */
export function FilterAutocomplete({
  value,
  onChange,
  onClear,
  placeholder,
  suggestionPool,
  inputRef,
  ariaLabel = "Filter",
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
  suggestionPool: string[];
  inputRef?: RefObject<HTMLInputElement | null>;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const listId = useRef(`filter-suggest-${Math.round(Math.random() * 1e9)}`).current;

  const suggestions = open ? filterSuggestions(suggestionPool, value) : [];

  // Keep the highlight within range as the suggestion list changes.
  useEffect(() => {
    setHighlight((current) => (current >= suggestions.length ? suggestions.length - 1 : current));
  }, [suggestions.length]);

  function accept(suggestion: string) {
    onChange(suggestion);
    setOpen(false);
    setHighlight(-1);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      // Only the dropdown's own keys are intercepted; everything else (incl.
      // Escape when closed) keeps its existing behavior.
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setHighlight((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setHighlight((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      if (highlight >= 0 && highlight < suggestions.length) {
        event.preventDefault();
        event.stopPropagation();
        accept(suggestions[highlight]);
      }
    } else if (event.key === "Escape") {
      // Contain Escape so the grid does not also handle it; just close.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setHighlight(-1);
    }
  }

  return (
    <div className="relative flex-1">
      <div className="flex h-8 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="ml-1 rounded text-muted-foreground hover:text-foreground"
            aria-label="Clear filter"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              role="option"
              aria-selected={index === highlight}
              // Pick before the input blur fires so the value is applied.
              onMouseDown={(event) => {
                event.preventDefault();
                accept(suggestion);
              }}
              onMouseEnter={() => setHighlight(index)}
              className={`cursor-pointer truncate px-3 py-1 text-sm ${
                index === highlight ? "bg-accent text-accent-foreground" : "text-foreground"
              }`}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
