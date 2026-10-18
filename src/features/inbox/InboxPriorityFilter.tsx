import { useRef } from "react";
import type { InboxPriority } from "./inboxPresentation";

const OPTIONS = [
  { value: "priority", label: "Priority" },
  { value: "other", label: "Other" },
  { value: "all", label: "All" },
] as const;

/** Priority / Other / All with their counts, in the list pane's dock tab strip. */
export function InboxPriorityFilter({ value, counts, onChange, onFocusList }: {
  value: InboxPriority;
  counts: Record<InboxPriority, number>;
  onChange: (value: InboxPriority) => void;
  onFocusList: () => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div role="radiogroup" aria-label="Inbox priority" className="flex shrink-0 items-center gap-0.5">
      {OPTIONS.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => { buttons.current[index] = element; }}
          type="button"
          role="radio"
          aria-label={option.label}
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            let next: number;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % OPTIONS.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + OPTIONS.length - 1) % OPTIONS.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = OPTIONS.length - 1;
            else if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onFocusList();
              return;
            } else return;
            event.preventDefault();
            event.stopPropagation();
            onChange(OPTIONS[next].value);
            buttons.current[next]?.focus();
          }}
          className={`rounded px-1.5 text-[11px] leading-4 focus:outline-none focus:ring-1 focus:ring-ring ${value === option.value ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"}`}
        >
          {option.label} <span className="tabular-nums">{counts[option.value]}</span>
        </button>
      ))}
    </div>
  );
}
