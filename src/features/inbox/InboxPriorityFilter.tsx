import { useId, useRef } from "react";
import type { InboxPriority } from "./inboxPresentation";

const OPTIONS = [
  { value: "priority", label: "Priority" },
  { value: "other", label: "Other" },
  { value: "all", label: "All" },
] as const;

export function InboxPriorityFilter({ value, onChange, onFocusList }: {
  value: InboxPriority;
  onChange: (value: InboxPriority) => void;
  onFocusList: () => void;
}) {
  const descriptionId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div className="shrink-0 border-b border-border px-2 py-1.5">
      <div role="radiogroup" aria-label="Inbox priority" aria-describedby={descriptionId} className="flex gap-1">
        {OPTIONS.map((option, index) => (
          <button
            key={option.value}
            ref={(element) => { buttons.current[index] = element; }}
            type="button"
            role="radio"
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
            className={`rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring ${value === option.value ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p id={descriptionId} className="mt-1 text-[11px] text-muted-foreground">
        Priority: direct PR / WI mentions. Other: general replies. Use arrow keys to switch, Enter for items.
      </p>
    </div>
  );
}
