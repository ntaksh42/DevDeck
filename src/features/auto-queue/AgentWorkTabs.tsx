import { useEffect, useRef } from "react";
import type { AgentWorkEntry } from "@/lib/azdoCommands";
import { nextSegmentIndex, SEGMENT_GROUP, segmentClass } from "@/components/segmentedFilter";
import { needsAttention, TABS, type AgentWorkTab } from "./agentWorkStatus";

/**
 * Agent Work's two tabs as counted segments in the list pane's tab band (the
 * Inbox Priority / Other / All look). Tab reaches the selected one; arrows
 * switch, Enter / Escape return to the list. 1-2 switch from anywhere.
 */
// Switching to or from Candidates remounts the tabs (they sit in a different
// part of the tree), so the segment to focus is carried across the remount.
let pendingFocusId: AgentWorkTab["id"] | null = null;

export function AgentWorkTabs({
  activeId,
  entries,
  onSelect,
  onFocusList,
}: {
  activeId: AgentWorkTab["id"];
  entries: AgentWorkEntry[];
  onSelect: (index: number) => void;
  onFocusList: () => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const attention = entries.filter(needsAttention).length;

  useEffect(() => {
    if (pendingFocusId !== activeId) return;
    pendingFocusId = null;
    buttons.current[TABS.findIndex((tab) => tab.id === activeId)]?.focus();
  }, [activeId]);

  return (
    <div role="tablist" aria-label="Agent work" className={SEGMENT_GROUP}>
      {TABS.map((tab, index) => {
        const selected = tab.id === activeId;
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
              if (next !== index) pendingFocusId = TABS[next].id;
              onSelect(next);
              buttons.current[next]?.focus();
            }}
            className={segmentClass(selected)}
          >
            {tab.label}{" "}
            {tab.id === "runs" ? (
              <span className="tabular-nums">
                {entries.filter((entry) => entry.status !== "succeeded").length}
                {attention > 0 ? (
                  <span className={selected ? "" : "font-bold text-destructive"}>{` · ${attention} need attention`}</span>
                ) : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
