import type { RefObject } from "react";
import { DockFilterBar, DockFilterInput, type useDockFilter } from "@/components/DockFilterBar";
import { ListStateChip } from "@/components/ListStatusBar";
import type { Organization } from "@/lib/azdoCommands";
import { InboxPriorityFilter } from "./InboxPriorityFilter";
import type { InboxPriority, InboxTab } from "./inboxPresentation";

/** Tab-band controls of the Inbox list pane: Done / Snoozed chip, organization, folded filter, priority. */
export function InboxListHeader({
  priority,
  priorityCounts,
  onPriorityChange,
  onFocusList,
  tab,
  onLeaveTab,
  organizations,
  organizationId,
  onOrganizationChange,
  filterText,
  onFilterTextChange,
  filterBar,
  filterInputRef,
}: {
  priority: InboxPriority;
  priorityCounts: Record<InboxPriority, number>;
  onPriorityChange: (priority: InboxPriority) => void;
  onFocusList: () => void;
  tab: InboxTab;
  /** Returns the list to the open items. */
  onLeaveTab: () => void;
  organizations: Organization[];
  organizationId: string;
  onOrganizationChange: (id: string) => void;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  filterBar: ReturnType<typeof useDockFilter>;
  filterInputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex h-full min-w-0 items-center gap-1.5">
      {tab !== "open" ? (
        <ListStateChip label={tab === "done" ? "Done" : "Snoozed"} onClear={onLeaveTab} />
      ) : null}
      {organizations.length > 1 ? (
        <select
          value={organizationId}
          onChange={(event) => onOrganizationChange(event.target.value)}
          aria-label="Filter by organization"
          className="h-4 rounded border border-input bg-background px-1 text-2xs outline-none focus:ring-2 focus:ring-ring"
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
      {/* Last in the band so Shift+Tab from the list reaches it first. */}
      <InboxPriorityFilter
        value={priority}
        counts={priorityCounts}
        onChange={onPriorityChange}
        onFocusList={onFocusList}
      />
    </div>
  );
}
