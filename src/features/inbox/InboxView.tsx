import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  commandErrorMessage,
  getActionInboxCounts,
  getAppSettings,
  listOrganizations,
  searchPullRequestMentions,
  setActionInboxItemState,
  type MentionCandidate,
} from "@/lib/azdoCommands";
import { navigateToPullRequest, navigateToWorkItem } from "@/lib/crossLinks";
import { openExternalUrl } from "@/lib/openExternal";
import { fetchWorkItemImageCached } from "@/lib/workItemImageCache";
import { clamp, focusPrimaryPreview, isEditableTarget } from "@/lib/utils";
import { useGridVirtualizer } from "@/lib/useGridVirtualizer";
import { useDockFilter } from "@/components/DockFilterBar";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { PreviewEmptyState } from "@/components/StateDisplay";
import { SnoozeMenu } from "@/components/SnoozeMenu";
import { openAgentPanel } from "@/components/agent/agentSubject";
import { InboxListPane } from "./InboxListPane";
import { INBOX_ROW_HEIGHT } from "./InboxRow";
import { InboxPreview } from "./InboxPreview";
import {
  agentRequestOf,
  isDerivedEntry,
  isPullRequestItem,
  isVoteItem,
  isWorkItemItem,
  type InboxEntry,
  type InboxLink,
  type InboxTab,
} from "./inboxPresentation";
import { useInboxDetail, type VoteValue } from "./useInboxDetail";
import { useInboxEntries } from "./useInboxEntries";

const OVERSCAN = 8;
const LAYOUT_STORAGE_KEY = "azdodeck:layout:inbox:dockview:v1";
const VOTE_KEYS: Record<string, VoteValue> = { a: 10, s: 5, w: -5, x: -10, "0": 0 };

export function InboxView({
  onOpenView,
}: {
  onOpenView?: (view: "pipelines") => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<InboxTab>("open");
  const [organizationId, setOrganizationId] = useState("");
  const [filterText, setFilterText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [snoozeAnchor, setSnoozeAnchor] = useState<DOMRect | null>(null);
  const [activateRequest, setActivateRequest] = useState<{ id: string; key: number }>();
  const listRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

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

  const { entries, derivedCount, isLoading, error, refetch } = useInboxEntries({
    tab,
    organizationId,
    filterText,
  });
  const countsQuery = useQuery({
    queryKey: ["actionInbox", "counts", organizationId],
    queryFn: () => getActionInboxCounts(organizationId || undefined),
    staleTime: 15_000,
  });
  const counts = countsQuery.data ?? { open: 0, snoozed: 0, done: 0 };
  const tabCounts: Record<InboxTab, number> = {
    open: counts.open + derivedCount,
    snoozed: counts.snoozed,
    done: counts.done,
  };

  const index = clamp(selectedIndex, 0, Math.max(entries.length - 1, 0));
  const selected: InboxEntry | null = entries[index] ?? null;
  useEffect(() => {
    setSelectedIndex((value) => clamp(value, 0, Math.max(entries.length - 1, 0)));
  }, [entries.length]);

  const detail = useInboxDetail(selected);

  // A reply from the agent has no conversation of its own to show.
  const agentOnly = selected?.kind === "agent_reply";

  /** Brings a dock panel to the front of its group (a no-op when it is already visible). */
  function activatePanel(id: "conversation") {
    setActivateRequest((current) => ({ id, key: (current?.key ?? 0) + 1 }));
  }
  useEffect(() => {
    if (selected) activatePanel("conversation");
  }, [selected?.id, agentOnly]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const stateMutation = useMutation({
    mutationFn: setActionInboxItemState,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["actionInbox"] });
    },
  });

  const virtual = useGridVirtualizer({
    rowCount: entries.length,
    rowHeight: INBOX_ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  function focusList() {
    window.setTimeout(() => listRef.current?.focus(), 0);
  }

  function moveSelectionTo(next: number) {
    const target = clamp(next, 0, entries.length - 1);
    virtual.scrollRowIntoView(target);
    setSelectedIndex(target);
  }

  /** Stored items change state locally; derived entries have none and are skipped. */
  function changeState(entry: InboxEntry, state: InboxTab, snoozedUntil?: string) {
    if (isDerivedEntry(entry)) return;
    stateMutation.mutate({ ids: [entry.id], state, snoozedUntil });
    focusList();
  }

  function openInApp(entry: InboxEntry) {
    if (isPullRequestItem(entry)) {
      navigateToPullRequest({
        organizationId: entry.organizationId,
        repositoryId: entry.repositoryId,
        pullRequestId: entry.subjectId,
      });
    } else if (isWorkItemItem(entry)) {
      navigateToWorkItem({ workItemId: entry.subjectId, organizationId: entry.organizationId });
    } else if (entry.kind === "pipeline_approval") {
      onOpenView?.("pipelines");
    } else if (entry.extra?.agentTarget === "pull-request") {
      navigateToPullRequest({ pullRequestId: entry.subjectId });
    } else if (entry.extra?.agentTarget === "work-item") {
      navigateToWorkItem({ workItemId: entry.subjectId, organizationId: entry.organizationId });
    }
  }

  function openInBrowser(entry: InboxEntry) {
    if (entry.webUrl) void openExternalUrl(entry.webUrl);
  }

  function openLink(link: InboxLink) {
    if (!selected) return;
    if (link.kind === "workItem") {
      navigateToWorkItem({ workItemId: link.id, organizationId: selected.organizationId });
    } else if (link.kind === "pullRequest") {
      navigateToPullRequest({ organizationId: selected.organizationId, pullRequestId: link.id });
    } else {
      void openExternalUrl(link.url);
    }
  }

  async function replyAndFinish(content: string) {
    if (!selected) return;
    const entry = selected;
    await detail.reply(content);
    changeState(entry, "done");
  }

  async function toggleThreadStatus() {
    if (!selected || !detail.thread) return;
    const entry = selected;
    const resolving = !detail.thread.isResolved;
    await detail.setResolved(resolving);
    // Resolving handles the item; reactivating a thread leaves it where it is.
    if (resolving) changeState(entry, "done");
  }

  async function vote(value: VoteValue) {
    if (!selected || readOnly) return;
    const entry = selected;
    await detail.vote(value);
    changeState(entry, "done");
  }

  async function commentAndFinish(markdown: string) {
    if (!selected) return;
    const entry = selected;
    await detail.commentOnWorkItem(markdown);
    changeState(entry, "done");
  }

  function decideApproval(status: "approved" | "rejected", comment?: string) {
    if (readOnly) return;
    void detail.decideApproval(status, comment).then(focusList);
  }

  function openSnoozeMenu() {
    if (!selected || tab !== "open" || isDerivedEntry(selected)) return;
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
    if (entries.length === 0) return;
    if (event.shiftKey && key === "Enter") {
      event.preventDefault();
      if (selected) openInApp(selected);
      return;
    }
    const lower = key.toLowerCase();
    if (key === "ArrowDown" || lower === "j") {
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
    } else if (lower === "e") {
      event.preventDefault();
      changeState(selected, tab === "done" ? "open" : "done");
    } else if (lower === "z") {
      event.preventDefault();
      if (tab === "snoozed") changeState(selected, "open");
      else openSnoozeMenu();
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
    } else if (lower in VOTE_KEYS || key === "0") {
      if (isVoteItem(selected)) {
        event.preventDefault();
        void vote(VOTE_KEYS[lower]);
      } else if (selected.kind === "pipeline_approval" && (lower === "a" || lower === "x")) {
        event.preventDefault();
        decideApproval(lower === "a" ? "approved" : "rejected");
      }
    } else if (/^[1-9]$/.test(key)) {
      const link = detail.links[Number(key) - 1];
      if (link) {
        event.preventDefault();
        openLink(link);
      }
    }
  }

  const returnToList = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !isEditableTarget(event.target)) {
      event.preventDefault();
      listRef.current?.focus();
    }
  };

  const panels: DockablePanelSpec[] = [
    {
      id: "list",
      title: "Items",
      minWidth: 340,
      content: (
        <InboxListPane
          tab={tab}
          tabCounts={tabCounts}
          onTabChange={switchTab}
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
          listRef={listRef}
          rowRefs={rowRefs}
          virtual={virtual}
          entries={entries}
          selectedIndex={index}
          isLoading={isLoading}
          error={error ? commandErrorMessage(error) : null}
          onRetry={refetch}
          onSelect={setSelectedIndex}
          onOpen={openInApp}
          onKeyDown={handleListKeyDown}
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
        <div className="flex items-center gap-1 pr-1">
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && openInApp(selected)}
            title="Open in DevDeck (Shift+Enter)"
            className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            Open in DevDeck
          </button>
          <button
            type="button"
            disabled={!selected?.webUrl}
            onClick={() => selected && openInBrowser(selected)}
            title="Open in Azure DevOps (O)"
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Browser
          </button>
        </div>
      ),
      content: (
        <div className="flex h-full min-h-0 flex-col bg-card" onKeyDown={returnToList}>
          {agentOnly ? (
            <div ref={previewRef} data-primary-preview="true" tabIndex={-1} className="min-h-0 flex-1 outline-none">
              <PreviewEmptyState message="This is the agent's reply. Press Q to read and answer it in the Agent panel." />
            </div>
          ) : (
            <InboxPreview
              item={selected}
              tab={tab}
              detail={detail}
              readOnly={readOnly}
              previewRef={previewRef}
              mentionSearch={mentionSearch}
              resolveImageSource={resolveImageSource}
              onReply={replyAndFinish}
              onToggleStatus={() => void toggleThreadStatus()}
              onVote={(value) => void vote(value)}
              onComment={commentAndFinish}
              onDecideApproval={decideApproval}
              onResolveAndDone={() => void toggleThreadStatus()}
              onDone={() => selected && changeState(selected, "done")}
              onReopen={() => selected && changeState(selected, "open")}
              onSnooze={(anchor) => setSnoozeAnchor(anchor)}
              onWake={() => selected && changeState(selected, "open")}
              onOpenLink={openLink}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1">
      <DockableWorkspace storageKey={LAYOUT_STORAGE_KEY} panels={panels} activatePanel={activateRequest} />

      {snoozeAnchor && selected ? (
        <SnoozeMenu
          anchorRect={snoozeAnchor}
          onSnooze={(until) => {
            changeState(selected, "snoozed", until);
            setSnoozeAnchor(null);
          }}
          onClose={() => setSnoozeAnchor(null)}
        />
      ) : null}
    </div>
  );
}
