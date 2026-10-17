import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  getActionInboxCounts,
  getAppSettings,
  listOrganizations,
  searchPullRequestMentions,
  type MentionCandidate,
} from "@/lib/azdoCommands";
import { fetchWorkItemImageCached } from "@/lib/workItemImageCache";
import { clamp, focusPrimaryPreview, isEditableTarget } from "@/lib/utils";
import { useGridVirtualizer } from "@/lib/useGridVirtualizer";
import { handlePreviewZoomKey, usePreviewZoom } from "@/lib/usePreviewZoom";
import { useDockFilter } from "@/components/DockFilterBar";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { SnoozeMenu } from "@/components/SnoozeMenu";
import { usePublishAgentListScope } from "@/components/agent/agentListScope";
import { openAgentPanel, usePublishAgentSubject } from "@/components/agent/agentSubject";
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
  isThreadItem,
  type InboxEntry,
  type InboxLink,
  type InboxTab,
} from "./inboxPresentation";
import { openInboxEntryInApp, openInboxEntryInBrowser, openInboxLink } from "./inboxNavigation";
import { useInboxDetail } from "./useInboxDetail";
import { useInboxEntries } from "./useInboxEntries";
import { useInboxListFocus } from "./useInboxListFocus";
import { useInboxChecked } from "./useInboxChecked";
import { useInboxStateChanges } from "./useInboxStateChanges";

const OVERSCAN = 8;
const LAYOUT_STORAGE_KEY = "azdodeck:layout:inbox:dockview:v1";

export function InboxView() {
  const [tab, setTab] = useState<InboxTab>("open");
  const [organizationId, setOrganizationId] = useState("");
  const [filterText, setFilterText] = useState("");
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

  const { entries: fetchedEntries, isLoading, error, refetch } = useInboxEntries({
    tab,
    organizationId,
    filterText,
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

  function moveSelectionTo(next: number) {
    const target = clamp(next, 0, entries.length - 1);
    virtual.scrollRowIntoView(target);
    setSelectedIndex(target);
    window.setTimeout(() => focusRow(target), 0);
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

  function switchTab(next: InboxTab) {
    setTab(next);
    setSelectedIndex(0);
  }

  function handleListKeyDown(event: React.KeyboardEvent) {
    if (isEditableTarget(event.target)) return;
    if (event.altKey || event.metaKey) return;
    if (event.ctrlKey) {
      if (event.key === "Enter" && selected) {
        event.preventDefault();
        openInBrowser(selected);
      }
      return;
    }
    const key = event.key;
    if (key === "/") {
      event.preventDefault();
      filterBar.onOpen();
      return;
    }
    if (key === "Escape" && checked.ids.size > 0) {
      event.preventDefault();
      checked.clear();
      return;
    }
    if (key.toLowerCase() === "u" && !event.shiftKey) {
      // Works on an emptied list too: undoing the last item brings it back.
      if (stateChanges.undoLast()) event.preventDefault();
      return;
    }
    if (entries.length === 0) return;
    if (event.shiftKey && key === "Enter") {
      event.preventDefault();
      if (selected) openInApp(selected);
      return;
    }
    const lower = key.toLowerCase();
    if (event.shiftKey && (key === "ArrowDown" || key === "ArrowUp")) {
      // Extends the marked range over the row being left and the one entered.
      event.preventDefault();
      const next = index + (key === "ArrowDown" ? 1 : -1);
      checked.add(entries[index], entries[next]);
      moveSelectionTo(next);
    } else if (key === "ArrowDown" || lower === "j") {
      event.preventDefault();
      moveSelectionTo(index + 1);
    } else if (key === "ArrowUp" || lower === "k") {
      event.preventDefault();
      moveSelectionTo(index - 1);
    } else if (key === "Home") {
      event.preventDefault();
      moveSelectionTo(0);
    } else if (key === "End") {
      event.preventDefault();
      moveSelectionTo(entries.length - 1);
    } else if (key === "PageDown") {
      event.preventDefault();
      moveSelectionTo(index + 10);
    } else if (key === "PageUp") {
      event.preventDefault();
      moveSelectionTo(index - 10);
    } else if (key === "Enter" || key === "ArrowRight") {
      event.preventDefault();
      focusPrimaryPreview();
    } else if (!selected) {
      return;
    } else if (lower === "o") {
      event.preventDefault();
      openInBrowser(selected);
    } else if (lower === "e" && event.shiftKey) {
      // Resolve + Done, the same as the preview's button.
      if (tab === "open" && isThreadItem(selected) && detail.thread && !detail.thread.isResolved && !readOnly) {
        event.preventDefault();
        void toggleThreadStatus();
      }
    } else if (lower === "x") {
      event.preventDefault();
      checked.toggle(selected);
    } else if (lower === "e") {
      event.preventDefault();
      changeMarkedOrSelected(selected, tab === "done" ? "open" : "done");
    } else if (lower === "d") {
      event.preventDefault();
      setContextExpanded((value) => !value);
    } else if (key === " ") {
      event.preventDefault();
      scrollPreview(event.shiftKey ? -1 : 1);
    } else if (lower === "z") {
      event.preventDefault();
      if (tab === "snoozed") changeMarkedOrSelected(selected, "open");
      else openSnoozeMenu();
    } else if (lower === "r" && event.shiftKey) {
      if (selected.insight?.replyDraft) {
        event.preventDefault();
        applyReplyDraft(selected.insight.replyDraft);
      }
    } else if (lower === "r") {
      event.preventDefault();
      activatePanel("conversation");
      // Wait for the panel to mount if it was stacked behind the agent's tab.
      window.setTimeout(() => {
        const preview = previewRef.current;
        const target =
          preview?.querySelector<HTMLElement>('[data-inbox-mention-reply="true"], [data-thread-reply="true"]') ??
          preview?.querySelector<HTMLElement>('[data-inbox-composer="true"] textarea');
        if (target instanceof HTMLTextAreaElement) target.focus();
        else target?.click();
      }, 0);
    } else if (lower === "q") {
      event.preventDefault();
      openAgentPanel(agentRequestOf(selected));
    } else if (lower === "c") {
      event.preventDefault();
      if (selected.webUrl) void navigator.clipboard?.writeText(selected.webUrl);
    } else if (/^[1-9]$/.test(key)) {
      const link = detail.links[Number(key) - 1];
      if (link) {
        event.preventDefault();
        openLink(link);
      }
    }
  }

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
          tabCounts={tabCounts}
          onTabChange={switchTab}
          filterText={filterText}
          listRef={listRef}
          focusHandlers={listFocus}
          onFocusList={() => focusRow(index)}
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
