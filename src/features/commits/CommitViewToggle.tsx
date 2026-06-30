import { type KeyboardEvent as ReactKeyboardEvent, useRef } from "react";
import { type CommitViewMode } from "./commitSearchConstants";

export function CommitViewToggle({
  value,
  onChange,
}: {
  value: CommitViewMode;
  onChange: (mode: CommitViewMode) => void;
}) {
  const tabs: { id: CommitViewMode; label: string }[] = [
    { id: "results", label: "Results" },
    { id: "activity", label: "Activity" },
  ];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: ReactKeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + tabs.length) % tabs.length;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Commit view"
      className="inline-flex rounded-md border border-border bg-card p-0.5"
    >
      {tabs.map((tab, index) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`rounded px-3 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring ${
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
