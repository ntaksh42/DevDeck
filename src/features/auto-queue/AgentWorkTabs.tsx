import { useRef } from "react";
import type { AgentWorkEntry } from "@/lib/azdoCommands";
import { nextSegmentIndex, SEGMENT_GROUP, segmentClass } from "@/components/segmentedFilter";
import { TABS, type AgentWorkTab } from "./agentWorkStatus";

/**
 * Agent Work's five tabs as counted segments in the list pane's tab band (the
 * Inbox Priority / Other / All look). Tab reaches the selected one; arrows
 * switch, Enter / Escape return to the list. 1-5 switch from anywhere.
 */
export function AgentWorkTabs({
  activeId,
  entries,
  unread,
  onSelect,
  onFocusList,
}: {
  activeId: AgentWorkTab["id"];
  entries: AgentWorkEntry[];
  unread: number;
  onSelect: (index: number) => void;
  onFocusList: () => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div role="tablist" aria-label="Agent work" className={SEGMENT_GROUP}>
      {TABS.map((tab, index) => {
        const selected = tab.id === activeId;
        const n = entries.filter(tab.matches).length;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-keyshortcuts={String(index + 1)}
            title={`${tab.label} (${index + 1})`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onFocusList();
                return;
              }
              const next = nextSegmentIndex(event.key, index, TABS.length);
              if (next === null) return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(next);
              buttons.current[next]?.focus();
            }}
            className={segmentClass(selected)}
          >
            {tab.label}{" "}
            {tab.id !== "candidates" ? (
              <span
                className={`tabular-nums ${
                  tab.id === "attention" && n > 0 && !selected ? "font-bold text-destructive" : ""
                }`}
              >
                {n}
                {tab.id === "results" && unread > 0 ? ` (${unread} new)` : ""}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
