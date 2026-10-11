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
import { SnoozeMenu } from "@/components/SnoozeMenu";
import { InboxAgentPanel } from "./InboxAgentPanel";
import { InboxListPane } from "./InboxListPane";
import { INBOX_ROW_HEIGHT } from "./InboxRow";
import { InboxPreview } from "./InboxPreview";
import {
  agentItemOf,
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
  const [previewTab, setPreviewTab] = useState<"conversation" | "agent">("conversation");
  const [askRequest, setAskRequest] = useState(0);
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
  const canAskAgent = !!selected && agentItemOf(selected) !== null;
  const activePreviewTab = agentOnly ? "agent" : canAskAgent ? previewTab : "conversation";
  useEffect(() => {
    // Each item opens on its conversation; the agent thread is one key away.
    setPreviewTab("conversation");
  }, [selected?.id]);

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
      const target = previewRef.current?.querySelector<HTMLElement>(
        '[data-thread-reply="true"], [data-inbox-composer="true"] textarea',
      );
      if (target instanceof HTMLTextAreaElement) target.focus();
      else target?.click();
    } else if (lower === "q") {
      event.preventDefault();
      if (canAskAgent) {
        setPreviewTab("agent");
        setAskRequest((value) => value + 1);
      }
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

  return (
    <div className="flex min-h-0 flex-1 gap-2">
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

      <section
        aria-label="Inbox preview"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border border-border bg-card"
      >
        <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-muted">
          <div role="tablist" aria-label="Preview" className="flex items-stretch">
            {(agentOnly
              ? ([["agent", "Agent"]] as const)
              : ([
                  ["conversation", "Conversation"],
                  ...(canAskAgent ? ([["agent", "Agent"]] as const) : []),
                ] as const)
            ).map(([id, label]) => {
              const active = activePreviewTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPreviewTab(id)}
                  className={`px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    active
                      ? "bg-background font-semibold text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1 pr-2">
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
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !isEditableTarget(event.target)) {
              event.preventDefault();
              listRef.current?.focus();
            }
          }}
        >
          {activePreviewTab === "agent" && selected ? (
            <InboxAgentPanel
              entry={selected}
              readOnly={readOnly}
              askRequest={askRequest}
              previewRef={previewRef}
              onReturnToList={() => listRef.current?.focus()}
            />
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
      </section>

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
