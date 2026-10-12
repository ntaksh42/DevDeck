import type { KeyboardEvent, RefObject } from "react";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { itemCount, ListStatusBar } from "@/components/ListStatusBar";
import { isEditableTarget } from "@/lib/utils";
import type { useGridVirtualizer } from "@/lib/useGridVirtualizer";
import type { useInboxListFocus } from "./useInboxListFocus";
import { InboxRow } from "./InboxRow";
import type { InboxEntry, InboxTab } from "./inboxPresentation";

const EMPTY_MESSAGE: Record<InboxTab, string> = {
  open: "Nothing needs your response.",
  snoozed: "No snoozed items.",
  done: "No finished items yet.",
};

/**
 * The left pane: the virtualized list and its status bar. The Done / Snoozed
 * buttons there switch the list to that state; the filter and the state chip
 * live in the dock tab band (see `InboxListHeader`).
 */
export function InboxListPane({
  tab,
  tabCounts,
  onTabChange,
  filterText,
  listRef,
  focusHandlers,
  onFocusList,
  rowRefs,
  virtual,
  entries,
  selectedIndex,
  isLoading,
  error,
  onRetry,
  onSelect,
  onOpen,
  onKeyDown,
}: {
  tab: InboxTab;
  tabCounts: Record<InboxTab, number>;
  onTabChange: (tab: InboxTab) => void;
  filterText: string;
  listRef: RefObject<HTMLDivElement | null>;
  focusHandlers: ReturnType<typeof useInboxListFocus>;
  onFocusList: () => void;
  rowRefs: RefObject<(HTMLDivElement | null)[]>;
  virtual: ReturnType<typeof useGridVirtualizer>;
  entries: InboxEntry[];
  selectedIndex: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (index: number) => void;
  onOpen: (entry: InboxEntry) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  const selected = entries[selectedIndex];
  const virtualRows = entries.slice(virtual.firstRow, virtual.lastRow);

  // Escape from the Done / Snoozed list (rows or status bar) returns to the open list.
  function handleSectionKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || tab === "open" || isEditableTarget(event.target)) return;
    event.preventDefault();
    onTabChange("open");
    window.setTimeout(() => listRef.current?.focus(), 0);
  }

  return (
    <section
      aria-label="Inbox"
      onKeyDown={handleSectionKeyDown}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : isLoading ? (
        <LoadingState />
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Inbox items"
          aria-activedescendant={selected ? `inbox-row-${selected.id}` : undefined}
          data-primary-grid="true"
          tabIndex={entries.length > 0 ? -1 : 0}
          onKeyDown={onKeyDown}
          onFocusCapture={focusHandlers.onFocusCapture}
          onBlurCapture={focusHandlers.onBlurCapture}
          onFocus={(event) => {
            if (event.target === event.currentTarget) onFocusList();
          }}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          {entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {filterText.trim() ? "No items match the filter." : EMPTY_MESSAGE[tab]}
            </div>
          ) : (
            <div ref={virtual.scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
              {virtual.topPadding > 0 ? <div style={{ height: virtual.topPadding }} /> : null}
              {virtualRows.map((entry, offset) => {
                const rowIndex = virtual.firstRow + offset;
                return (
                  <InboxRow
                    key={entry.id}
                    ref={(el) => {
                      rowRefs.current[rowIndex] = el;
                    }}
                    item={entry}
                    tab={tab}
                    domId={`inbox-row-${entry.id}`}
                    selected={rowIndex === selectedIndex}
                    onSelect={() => onSelect(rowIndex)}
                    onOpen={() => onOpen(entry)}
                  />
                );
              })}
              {virtual.bottomPadding > 0 ? <div style={{ height: virtual.bottomPadding }} /> : null}
            </div>
          )}
        </div>
      )}

      <ListStatusBar
        summary={[itemCount(entries.length)]}
        done={{ count: tabCounts.done, active: tab === "done", onToggle: () => onTabChange(tab === "done" ? "open" : "done") }}
        snoozed={{
          count: tabCounts.snoozed,
          active: tab === "snoozed",
          onToggle: () => onTabChange(tab === "snoozed" ? "open" : "snoozed"),
        }}
        helpSection="inbox"
      />
    </section>
  );
}
