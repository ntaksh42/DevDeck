import type { MentionCandidate } from "@/lib/azdoCommands";
import { CandidateAvatar, HighlightedText } from "./PreviewEditors";
import { scrollMentionOptionIntoView } from "./workItemMentions";

// Presentational @mention option list, positioned above the textarea it is
// nested in (its parent must be `relative`). Shared by the new-comment composer
// and the inline edit textarea; all state lives in useWorkItemMentionPicker.
export function MentionPickerDropdown({
  options,
  activeIndex,
  query,
  errorMessage,
  onSelect,
}: {
  options: MentionCandidate[];
  activeIndex: number;
  query: string;
  errorMessage: string | null;
  onSelect: (candidate: MentionCandidate) => void;
}) {
  if (options.length > 0) {
    return (
      <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">
        {options.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            ref={index === activeIndex ? scrollMentionOptionIntoView : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(candidate)}
            className={`flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm ${
              index === activeIndex ? "bg-secondary" : "hover:bg-muted"
            }`}
          >
            <CandidateAvatar displayName={candidate.displayName} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">
                <HighlightedText text={candidate.displayName} query={query} />
              </span>
              {candidate.uniqueName ? (
                <span className="truncate text-xs text-muted-foreground">
                  <HighlightedText text={candidate.uniqueName} query={query} />
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    );
  }
  if (errorMessage) {
    return (
      <div className="absolute bottom-full left-0 z-20 mb-1 w-full rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive shadow-lg">
        Search failed: {errorMessage}
      </div>
    );
  }
  return null;
}
