import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  generateActionInboxInsight,
  getActionInboxCounts,
  getAppSettings,
  listOrganizations,
  searchPullRequestMentions,
  type MentionCandidate,
} from "@/lib/azdoCommands";
import { fetchWorkItemImageCached } from "@/lib/workItemImageCache";
import { pushToast } from "@/lib/toast";
import { clamp, isEditableTarget } from "@/lib/utils";
import { useGridVirtualizer } from "@/lib/useGridVirtualizer";
import { parkGridFocus } from "@/lib/parkGridFocus";
import { handlePreviewZoomKey, usePreviewZoom } from "@/lib/usePreviewZoom";
import { useDockFilter } from "@/components/DockFilterBar";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { ColumnFilterDropdown } from "@/components/ColumnFilterDropdown";
import { SnoozeMenu } from "@/components/SnoozeMenu";
import { toggleColumnFilterValue } from "@/lib/columnFilters";
import type { InboxFilterColumn } from "./inboxColumnFilters";
import { usePublishAgentListScope } from "@/components/agent/agentListScope";
import { openAgentPanel, usePublishAgentSubject } from "@/components/agent/agentSubject";
import { inboxListKeyHandler } from "./inboxListKeyHandler";
import { inboxAgentList } from "./inboxAgentList";
import { InboxListHeader } from "./InboxListHeader";
import { InboxListPane } from "./InboxListPane";
import { INBOX_ROW_HEIGHT } from "./InboxRow";
import { InboxPreview } from "./InboxPreview";
import { InboxPreviewToolbar } from "./InboxPreviewToolbar";
import type { ReplySeed } from "./InboxPreviewPanels";
import {
  agentRequestOf,
  inboxAgentSubject,
  type InboxEntry,
  type InboxLink,
  type InboxPriority,
  type InboxTab,
} from "./inboxPresentation";
import { openInboxEntryInApp, openInboxEntryInBrowser, openInboxLink } from "./inboxNavigation";
import { useInboxDetail } from "./useInboxDetail";
import { useInboxEntries } from "./useInboxEntries";
import { useInboxListFocus } from "./useInboxListFocus";
import { useInboxChecked } from "./useInboxChecked";
import { useInboxStateChanges } from "./useInboxStateChanges";

const OVERSCAN = 8;
/** Comment kinds Claude can write notes for (matches the backend). */
const INSIGHT_KINDS: string[] = ["pr_mention", "pr_reply", "wi_mention"];
const LAYOUT_STORAGE_KEY = "azdodeck:layout:inbox:dockview:v1";

export function InboxView() {
  const [tab, setTab] = useState<InboxTab>("open");
  const [priority, setPriority] = useState<InboxPriority>("all");
  const [organizationId, setOrganizationId] = useState("");
  const [filterText, setFilterText] = useState("");
  const [columnFilters, setColumnFilters] = useState<Partial<Record<InboxFilterColumn, Set<string>>>>({});
  const [openFilterCol, setOpenFilterCol] = useState<InboxFilterColumn | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const filterButtonRef = useRef<HTMLElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [snoozeAnchor, setSnoozeAnchor] = useState<DOMRect | null>(null);
  const [activateRequest, setActivateRequest] = useState<{ id: string; key: number }>();
  // D: the description / work item body in the preview's Context, collapsed per item.
  const [contextExpanded, setContextExpanded] = useState(false);
  // Shift+R: Claude's reply draft put into the reply box, per item.
  const [draft, setDraft] = useState<ReplySeed>();
  const listRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { zoom, canZoomIn, canZoomOut, zoomIn, zoomOut, resetZoom } = usePreviewZoom();
  const filterBar = useDockFilter(filterInputRef, () => listRef.current?.focus());

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    staleTime: 5 * 60_000,
  });
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const readOnly = settingsQuery.data?.readOnlyValidationModeEnabled ?? false;
  const insightEnabled = settingsQuery.data?.inboxInsightEnabled ?? false;

  const { entries: fetchedEntries, priorityCounts, columnUniqueValues, isLoading, error, refetch } = useInboxEntries({
    tab,
    priority,
    organizationId,
    filterText,
    columnFilters,
  });
  const stateChanges = useInboxStateChanges({
    entries: fetchedEntries,
    tab,
    onReselect: (target) => moveSelectionTo(target),
  });
  const entries = stateChanges.visibleEntries;
  const checked = useInboxChecked(entries);
  const countsQuery = useQuery({
    queryKey: ["actionInbox", "counts", organizationId],
    queryFn: () => getActionInboxCounts(organizationId || undefined),
    staleTime: 15_000,
  });
  const counts = countsQuery.data ?? { open: 0, snoozed: 0, done: 0 };
  const tabCounts: Record<InboxTab, number> = {
    open: counts.open,
    snoozed: counts.snoozed,
    done: counts.done,
  };

  const index = clamp(selectedIndex, 0, Math.max(entries.length - 1, 0));
  const selected: InboxEntry | null = entries[index] ?? null;
  useEffect(() => {
    setSelectedIndex((value) => clamp(value, 0, Math.max(entries.length - 1, 0)));
  }, [entries.length]);

  const detail = useInboxDetail(selected);
  // The Agent panel follows the selected entry's pull request / work item.
  usePublishAgentSubject(selected ? inboxAgentSubject(selected) : null);
  usePublishAgentListScope(inboxAgentList(entries, tab, filterText));

  /** Brings a dock panel to the front of its group (a no-op when it is already visible). */
  function activatePanel(id: "conversation") {
    setActivateRequest((current) => ({ id, key: (current?.key ?? 0) + 1 }));
  }
  useEffect(() => {
    if (selected) activatePanel("conversation");
    setContextExpanded(false);
    setDraft(undefined);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mentionSearch = useCallback(
    (query: string): Promise<MentionCandidate[]> =>
      searchPullRequestMentions({ organizationId: selected?.organizationId, query }),
    [selected?.organizationId],
  );
  const resolveImageSource = useCallback(
    (url: string) =>
      fetchWorkItemImageCached({ organizationId: selected?.organizationId ?? "", url }),
    [selected?.organizationId],
  );

  const virtual = useGridVirtualizer({
    rowCount: entries.length,
    rowHeight: INBOX_ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const listFocus = useInboxListFocus({ listRef, rowRefs, index, entries, scrollRowIntoView: virtual.scrollRowIntoView });
  const { focusList, focusRow } = listFocus;

  const parkingFocusRef = useRef(false);
  function moveSelectionTo(next: number) {
    const target = clamp(next, 0, entries.length - 1);
    // Parking focus on the list must not bounce it straight back to the old row.
    parkingFocusRef.current = true;
    parkGridFocus(rowRefs.current[target]);
    parkingFocusRef.current = false;
    virtual.scrollRowIntoView(target);
    setSelectedIndex(target);
    // The target row may not have mounted yet (it scrolls into the virtual
    // window first). Park focus on the list then; useInboxListFocus moves it
    // onto the row once it mounts, instead of losing it to <body>.
    window.setTimeout(() => {
      if (!focusRow(target)) listRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  /** The item leaves the list at once, so the next row is selected and the list keeps focus. */
  function changeState(entry: InboxEntry, state: InboxTab, snoozedUntil?: string, resolved = false) {
    stateChanges.changeState(entry, state, snoozedUntil, { resolved });
    focusList();
  }

  /** E / Z on marked items applies to all of them; with none marked it is the selected row. */
  function changeMarkedOrSelected(entry: InboxEntry, state: InboxTab, snoozedUntil?: string) {
    if (checked.checkedEntries.length === 0) return changeState(entry, state, snoozedUntil);
    stateChanges.changeStates(checked.checkedEntries, state, snoozedUntil);
    checked.clear();
    focusList();
  }

  /** Scrolls the preview by about a page without moving focus off the list. */
  function scrollPreview(direction: 1 | -1) {
    const preview = previewRef.current;
    if (!preview) return;
    preview.scrollBy({ top: direction * Math.max(preview.clientHeight * 0.9, 40) });
  }

  const openInApp = openInboxEntryInApp;

  // Notes can be asked for on any open comment item (beyond the few each sync
  // writes, or again after a failure) while summaries are on and none is running.
  function canGenerateInsight(entry: InboxEntry | null): entry is InboxEntry {
    return (
      insightEnabled &&
      tab === "open" &&
      entry !== null &&
      INSIGHT_KINDS.includes(entry.kind) &&
      entry.insight?.status !== "pending"
    );
  }

  function generateInsight(entry: InboxEntry) {
    generateActionInboxInsight(entry.id).catch((error: unknown) => {
      pushToast(`Could not start the notes: ${commandErrorMessage(error)}`);
    });
  }

  function applyReplyDraft(text: string) {
    if (readOnly || !text) return;
    activatePanel("conversation");
    setDraft((current) => ({ text, key: (current?.key ?? 0) + 1 }));
  }
  const openInBrowser = openInboxEntryInBrowser;
  const openLink = (link: InboxLink) => selected && openInboxLink(link, selected.organizationId);

  async function replyAndFinish(content: string) {
    if (!selected) return;
    const entry = selected;
    await detail.reply(content);
    changeState(entry, "done");
  }

  /** Ctrl+Shift+Enter in the reply box: one step for "answered, and the thread is settled". */
  async function replyResolveAndFinish(content: string) {
    if (!selected) return;
    const entry = selected;
    await detail.reply(content);
    try {
      await detail.setResolved(true);
    } catch {
      // The reply is posted, so the draft must clear; the item stays open and
      // the preview shows why the thread could not be resolved.
      return;
    }
    changeState(entry, "done", undefined, true);
  }

  async function toggleThreadStatus() {
    if (!selected || !detail.thread) return;
    const entry = selected;
    const resolving = !detail.thread.isResolved;
    await detail.setResolved(resolving);
    // Resolving handles the item; reactivating a thread leaves it where it is.
    if (resolving) changeState(entry, "done", undefined, true);
  }

  async function commentAndFinish(markdown: string) {
    if (!selected) return;
    const entry = selected;
    await detail.commentOnWorkItem(markdown);
    changeState(entry, "done");
  }

  function openSnoozeMenu() {
    if (!selected || tab !== "open") return;
    const row = rowRefs.current[index];
    const anchor = row?.isConnected ? row : listRef.current;
    if (anchor) setSnoozeAnchor(anchor.getBoundingClientRect());
  }

  function openColumnFilter(column: InboxFilterColumn, anchorEl: HTMLButtonElement) {
    filterButtonRef.current = anchorEl;
    setFilterAnchorRect(anchorEl.getBoundingClientRect());
    setOpenFilterCol(column);
  }

  function closeColumnFilter() {
    setOpenFilterCol(null);
    setFilterAnchorRect(null);
  }

  /** Every column-filter change narrows the list, so the selection restarts at the top. */
  function updateColumnFilters(update: (prev: typeof columnFilters) => typeof columnFilters) {
    setColumnFilters(update);
    setSelectedIndex(0);
  }

  function switchTab(next: InboxTab) {
    setTab(next);
    setSelectedIndex(0);
  }

  const handleListKeyDown = inboxListKeyHandler({
    selected, entries, index, tab, checked, stateChanges, detail, readOnly,
    filterBar, moveSelectionTo, openInBrowser, openInApp, toggleThreadStatus,
    changeMarkedOrSelected, setContextExpanded, scrollPreview, openSnoozeMenu,
    canGenerateInsight, generateInsight, applyReplyDraft, activatePanel, previewRef, openLink,
  });

  const returnToList = (event: React.KeyboardEvent) => {
    if (handlePreviewZoomKey(event, { zoomIn, zoomOut, resetZoom })) return;
    if (event.key === "Escape" && !isEditableTarget(event.target)) {
      event.preventDefault();
      focusList();
    }
  };

  const panels: DockablePanelSpec[] = [
    {
      id: "list",
      title: "Items",
      minWidth: 340,
      headerActions: (
        <InboxListHeader
          priority={priority}
          priorityCounts={priorityCounts}
          onPriorityChange={(value) => {
            setPriority(value);
            setSelectedIndex(0);
          }}
          onFocusList={() => listRef.current?.focus()}
          tab={tab}
          onLeaveTab={() => {
            switchTab("open");
            focusList();
          }}
          organizations={organizationsQuery.data ?? []}
          organizationId={organizationId}
          onOrganizationChange={(id) => {
            setOrganizationId(id);
            setSelectedIndex(0);
          }}
          filterText={filterText}
          onFilterTextChange={(value) => {
            setFilterText(value);
            setSelectedIndex(0);
          }}
          filterBar={filterBar}
          filterInputRef={filterInputRef}
        />
      ),
      content: (
        <InboxListPane
          tab={tab}
          priority={priority}
          tabCounts={tabCounts}
          onTabChange={switchTab}
          filterText={filterText}
          columnFilters={columnFilters}
          onOpenColumnFilter={openColumnFilter}
          onClearColumnFilters={() => updateColumnFilters(() => ({}))}
          listRef={listRef}
          focusHandlers={listFocus}
          onFocusList={() => {
            if (!parkingFocusRef.current) focusRow(index);
          }}
          rowRefs={rowRefs}
          virtual={virtual}
          entries={entries}
          selectedIndex={index}
          checkedIds={checked.ids}
          isLoading={isLoading}
          error={error ? commandErrorMessage(error) : null}
          onRetry={refetch}
          onSelect={(target) => {
            setSelectedIndex(target);
            focusRow(target);
          }}
          onOpen={openInApp}
          onKeyDown={handleListKeyDown}
          undo={stateChanges.undo}
          onUndo={() => {
            stateChanges.undoLast();
            focusList();
          }}
        />
      ),
    },
    {
      id: "conversation",
      title: "Conversation",
      position: { relativeTo: "list", direction: "right" },
      initialWidth: 560,
      minWidth: 360,
      headerActions: (
        <InboxPreviewToolbar
          zoom={{ zoom, canZoomIn, canZoomOut, onZoomIn: zoomIn, onZoomOut: zoomOut, onResetZoom: resetZoom }}
          canOpenInApp={!!selected}
          canOpenInBrowser={!!selected?.webUrl}
          canCopyLink={!!selected?.webUrl}
          canAskAgent={!!selected}
          onOpenInApp={() => selected && openInApp(selected)}
          onOpenInBrowser={() => selected && openInBrowser(selected)}
          onCopyLink={() => selected?.webUrl && void navigator.clipboard?.writeText(selected.webUrl)}
          onAskAgent={() => selected && openAgentPanel(agentRequestOf(selected))}
        />
      ),
      content: (
        <div className="flex h-full min-h-0 flex-col bg-card" onKeyDown={returnToList}>
          <InboxPreview
            item={selected}
              tab={tab}
              zoom={zoom}
              detail={detail}
              readOnly={readOnly}
              previewRef={previewRef}
              mentionSearch={mentionSearch}
              resolveImageSource={resolveImageSource}
              onReply={replyAndFinish}
              onReplyAndResolve={replyResolveAndFinish}
              onToggleStatus={() => void toggleThreadStatus()}
              onComment={commentAndFinish}
              onResolveAndDone={() => void toggleThreadStatus()}
              onDone={() => selected && changeState(selected, "done")}
              onReopen={() => selected && changeState(selected, "open")}
              onSnooze={(anchor) => setSnoozeAnchor(anchor)}
              onWake={() => selected && changeState(selected, "open")}
              onOpenLink={openLink}
              contextExpanded={contextExpanded}
              onToggleContext={() => setContextExpanded((value) => !value)}
              draft={draft}
              onUseDraft={applyReplyDraft}
              onGenerateInsight={
                canGenerateInsight(selected) ? () => generateInsight(selected) : undefined
              }
            />
        </div>
      ),
    },
  ];

  return (
    <div
      className="flex min-h-0 flex-1"
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented && !isEditableTarget(event.target) &&
          event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
          event.key === "Enter" && selected
        ) {
          event.preventDefault();
          openInBrowser(selected);
        }
      }}
    >
      <DockableWorkspace storageKey={LAYOUT_STORAGE_KEY} panels={panels} activatePanel={activateRequest} />

      {openFilterCol && filterAnchorRect ? (
        <ColumnFilterDropdown
          anchorRect={filterAnchorRect}
          allValues={columnUniqueValues[openFilterCol] ?? []}
          activeValues={columnFilters[openFilterCol]}
          onToggle={(value) =>
            updateColumnFilters((prev) =>
              toggleColumnFilterValue(prev, openFilterCol, value, columnUniqueValues[openFilterCol] ?? []),
            )
          }
          onClearAll={() =>
            updateColumnFilters((prev) => {
              const { [openFilterCol]: _, ...rest } = prev;
              return rest;
            })
          }
          onUncheckAll={() => updateColumnFilters((prev) => ({ ...prev, [openFilterCol]: new Set<string>() }))}
          restoreFocusRef={filterButtonRef}
          onClose={closeColumnFilter}
        />
      ) : null}

      {snoozeAnchor && selected ? (
        <SnoozeMenu
          anchorRect={snoozeAnchor}
          onSnooze={(until) => {
            changeMarkedOrSelected(selected, "snoozed", until);
            setSnoozeAnchor(null);
          }}
          onClose={() => setSnoozeAnchor(null)}
        />
      ) : null}
    </div>
  );
}
