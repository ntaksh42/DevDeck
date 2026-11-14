import { useRef } from "react";
import { nextSegmentIndex, SEGMENT_GROUP, segmentClass } from "@/components/segmentedFilter";
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
    <div role="radiogroup" aria-label="Inbox priority" className={SEGMENT_GROUP}>
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
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onFocusList();
              return;
            }
            const next = nextSegmentIndex(event.key, index, OPTIONS.length);
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            onChange(OPTIONS[next].value);
            buttons.current[next]?.focus();
          }}
          className={segmentClass(value === option.value)}
        >
          {option.label} <span className="tabular-nums">{counts[option.value]}</span>
        </button>
      ))}
    </div>
  );
}
