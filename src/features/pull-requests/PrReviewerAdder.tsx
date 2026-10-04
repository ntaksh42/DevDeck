import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { searchPullRequestMentions } from "@/lib/azdoCommands";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

const MAX_RESULTS = 8;
const CHIP_BUTTON =
  "inline-flex items-center gap-0.5 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export type AddReviewerRequest = { reviewerId?: string; isRequired: boolean };

// "Add" opens an identity search (the same directory lookup @mentions use) right
// under the reviewers row; "Add me" adds the signed-in user in one step. The
// picker is keyboard-complete: type to search, ArrowUp/Down to move, Enter to
// add, Esc to close, and focus returns to the button that opened it.
export function PrReviewerAdder({
  organizationId,
  existingReviewerIds,
  canAddMe,
  busy,
  onAdd,
}: {
  organizationId: string;
  existingReviewerIds: ReadonlySet<string>;
  canAddMe: boolean;
  busy: boolean;
  onAdd: (request: AddReviewerRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [required, setRequired] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const term = useDebouncedValue(query.trim(), 200);
  const search = useQuery({
    queryKey: ["prReviewerSearch", organizationId, term],
    queryFn: () => searchPullRequestMentions({ organizationId, query: term }),
    enabled: open && term.length >= 2,
    staleTime: 30_000,
  });
  const candidates = (search.data ?? [])
    .filter((candidate) => !existingReviewerIds.has(candidate.id))
    .slice(0, MAX_RESULTS);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => setActiveIndex(0), [term]);

  function close() {
    setOpen(false);
    setQuery("");
    setRequired(false);
    window.setTimeout(() => openButtonRef.current?.focus(), 0);
  }

  function add(reviewerId: string | undefined) {
    onAdd({ reviewerId, isRequired: required });
    close();
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (candidates.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + step + candidates.length) % candidates.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const candidate = candidates[activeIndex];
      if (candidate) add(candidate.id);
    }
  }

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        disabled={busy}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        title="Add a reviewer"
        className={CHIP_BUTTON}
      >
        <Plus className="h-3 w-3" aria-hidden="true" /> Add
      </button>
      {canAddMe ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdd({ isRequired: false })}
          title="Add yourself as a reviewer"
          className={CHIP_BUTTON}
        >
          Add me
        </button>
      ) : null}
      {open ? (
        <div className="mt-1 flex w-full flex-col gap-1 rounded border border-border bg-muted/40 p-1.5">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={candidates.length > 0}
              aria-controls="pr-reviewer-results"
              aria-label="Search people to add as a reviewer"
              aria-activedescendant={
                candidates[activeIndex] ? `pr-reviewer-option-${activeIndex}` : undefined
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search people (2+ characters)"
              className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={required}
                onChange={(event) => setRequired(event.target.checked)}
              />
              Required
            </label>
          </div>
          {term.length >= 2 && !search.isFetching && candidates.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">No matching people.</p>
          ) : null}
          {candidates.length > 0 ? (
            <ul id="pr-reviewer-results" role="listbox" aria-label="People">
              {candidates.map((candidate, index) => (
                <li
                  key={candidate.id}
                  id={`pr-reviewer-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(candidate.id)}
                  className={`flex cursor-pointer items-baseline gap-2 rounded px-1.5 py-0.5 text-xs ${
                    index === activeIndex ? "bg-secondary" : "hover:bg-secondary/60"
                  }`}
                >
                  <span className="truncate font-medium text-foreground">
                    {candidate.displayName}
                  </span>
                  {candidate.uniqueName ? (
                    <span className="truncate text-muted-foreground">{candidate.uniqueName}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
