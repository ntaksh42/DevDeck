import type { KeyboardEvent, RefObject } from "react";
import { DockFilterBar, DockFilterInput } from "@/components/DockFilterBar";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import type { Organization } from "@/lib/azdoCommands";
import type { useDockFilter } from "@/components/DockFilterBar";
import type { useGridVirtualizer } from "@/lib/useGridVirtualizer";
import { InboxRow } from "./InboxRow";
import { INBOX_TABS, type InboxEntry, type InboxTab } from "./inboxPresentation";

const EMPTY_MESSAGE: Record<InboxTab, string> = {
  open: "Nothing needs your response.",
  snoozed: "No snoozed items.",
  done: "No finished items yet.",
};

/** The left pane: tabs with counts, the folded filter, and the virtualized list. */
export function InboxListPane({
  tab,
  tabCounts,
  onTabChange,
  organizations,
  organizationId,
  onOrganizationChange,
  filterText,
  onFilterTextChange,
  filterBar,
  filterInputRef,
  listRef,
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
  organizations: Organization[];
  organizationId: string;
  onOrganizationChange: (id: string) => void;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  filterBar: ReturnType<typeof useDockFilter>;
  filterInputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
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

  function handleTabKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const position = INBOX_TABS.findIndex((candidate) => candidate.id === tab);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = INBOX_TABS[(position + delta + INBOX_TABS.length) % INBOX_TABS.length];
    onTabChange(next.id);
    window.setTimeout(() => document.getElementById(`inbox-tab-${next.id}`)?.focus(), 0);
  }

  return (
    <section
      aria-label="Inbox"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      <div
        role="tablist"
        aria-label="Inbox lists"
        onKeyDown={handleTabKeyDown}
        className="flex h-8 shrink-0 items-stretch border-b border-border bg-muted"
      >
        {INBOX_TABS.map((candidate) => {
          const active = candidate.id === tab;
          return (
            <button
              key={candidate.id}
              id={`inbox-tab-${candidate.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onTabChange(candidate.id)}
              className={`flex items-center gap-1.5 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                active
                  ? "bg-background font-semibold text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {candidate.label}
              <span className="rounded-full border border-border bg-background px-1.5 text-[11px] font-medium">
                {tabCounts[candidate.id]}
              </span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 pr-2">
          {organizations.length > 1 ? (
            <select
              value={organizationId}
              onChange={(event) => onOrganizationChange(event.target.value)}
              aria-label="Filter by organization"
              className="h-5 rounded border border-input bg-background px-1 text-[11px] outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          ) : null}
          <DockFilterBar
            label="Filter inbox"
            open={filterBar.open}
            onOpen={filterBar.onOpen}
            onClose={filterBar.onClose}
            inputRef={filterInputRef}
            hasValue={filterText.trim().length > 0}
            chips={
              filterText.trim()
                ? [{ label: filterText.trim(), onClear: () => onFilterTextChange("") }]
                : []
            }
          >
            <DockFilterInput
              inputRef={filterInputRef}
              value={filterText}
              onChange={onFilterTextChange}
              placeholder="Filter by title, author, repo…"
              ariaLabel="Filter inbox items"
            />
          </DockFilterBar>
        </div>
      </div>

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
          tabIndex={0}
          onKeyDown={onKeyDown}
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

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 border-t border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        <span>
          Open {tabCounts.open} · Snoozed {tabCounts.snoozed} · Done {tabCounts.done}
        </span>
        <span className="ml-auto">
          E done · Z snooze · R reply · Q agent · A/S/W/X vote · Shift+Enter open in DevDeck · O browser · 1-9
          links
        </span>
      </div>
    </section>
  );
}
