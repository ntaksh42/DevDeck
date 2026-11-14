import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentWorkKey,
  commandErrorMessage,
  listAgentWork,
  retryAgentWork,
  setAgentWorkExcluded,
  type AgentWorkEntry,
} from "@/lib/azdoCommands";
import { subscribeTauriEvent } from "@/lib/tauriEvents";
import { pushToast } from "@/lib/toast";
import { clamp, isEditableTarget } from "@/lib/utils";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { AutoQueueView } from "./AutoQueueView";
import { AgentWorkPreview, AgentWorkResult } from "./AgentWorkPreview";
import { openEntryInApp, openEntryInBrowser } from "./AgentWorkLinks";
import { agentWorkSubject, StatusBadge, TABS, timeLabel, type AgentWorkTab } from "./agentWorkStatus";
import { openAgentPanel, usePublishAgentSubject } from "@/components/agent/agentSubject";
import { addSeen, loadSeen, seenKey } from "./agentWorkSeen";

const WORK_KEY = ["agentWork"];

export function AgentWorkView() {
  const queryClient = useQueryClient();
  const workQuery = useQuery({ queryKey: WORK_KEY, queryFn: listAgentWork, refetchInterval: 10_000 });
  const entries = useMemo(() => workQuery.data ?? [], [workQuery.data]);
  const [tabId, setTabId] = useState<AgentWorkTab["id"] | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  // Bumped to bring the Result panel's tab to the front.
  const [resultRequest, setResultRequest] = useState(0);
  const [seen, setSeen] = useState<string[]>(loadSeen);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => subscribeTauriEvent("sync:updated", () => void queryClient.invalidateQueries({ queryKey: WORK_KEY })),
    [queryClient],
  );

  // Open on what needs a decision; with nothing failed, on the latest results.
  const attentionCount = entries.filter(TABS[0].matches).length;
  const activeTab = TABS.find((tab) => tab.id === tabId) ?? (workQuery.isSuccess && attentionCount === 0 ? TABS[2] : TABS[0]);
  const items = useMemo(() => entries.filter(activeTab.matches), [entries, activeTab]);
  const focused = items.find((item) => agentWorkKey(item) === focusKey) ?? items[0] ?? null;
  const focusedIndex = focused ? items.indexOf(focused) : -1;
  // The Agent panel follows the selected item, so questions go to its conversation.
  const subject = focused && activeTab.id !== "candidates" ? agentWorkSubject(focused) : null;
  usePublishAgentSubject(subject);
  const unread = entries.filter((e) => e.status === "succeeded" && !seen.includes(seenKey(e))).length;

  // A result counts as read once it was shown.
  useEffect(() => {
    if (focused?.status === "succeeded") setSeen((current) => addSeen(current, focused));
  }, [focused]);

  useEffect(() => setShowLog(false), [focusKey, tabId]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: WORK_KEY });
    void queryClient.invalidateQueries({ queryKey: ["autoQueue"] });
  }, [queryClient]);

  const retry = useMutation({
    mutationFn: retryAgentWork,
    onSuccess: () => {
      pushToast("Retrying now. It runs after the agent's current run finishes.");
      refresh();
    },
    onError: (error) => pushToast(commandErrorMessage(error)),
  });
  const exclude = useMutation({
    mutationFn: (entry: AgentWorkEntry) => setAgentWorkExcluded(entry, !entry.excluded),
    onSuccess: (_, entry) => {
      pushToast(entry.excluded ? "Included in automatic runs again." : "Excluded from automatic runs.");
      refresh();
    },
    onError: (error) => pushToast(commandErrorMessage(error)),
  });

  const focusList = () => listRef.current?.focus();
  // The list lives in a dock panel that mounts after this view, so it takes
  // focus when it attaches; later tab switches focus it directly.
  const wantsFocusRef = useRef(true);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    if (element && wantsFocusRef.current) {
      wantsFocusRef.current = false;
      element.focus();
    }
  }, []);
  useEffect(() => {
    if (listRef.current) listRef.current.focus();
    else wantsFocusRef.current = true;
  }, [workQuery.isLoading, activeTab.id]);

  const selectTab = (index: number) => {
    const tab = TABS[index];
    if (!tab) return;
    setTabId(tab.id);
    setFocusKey(null);
    if (tab.id === "results") setResultRequest((n) => n + 1);
  };

  const move = (index: number) => {
    const target = items[clamp(index, 0, items.length - 1)];
    if (!target) return;
    setFocusKey(agentWorkKey(target));
    const row = listRef.current?.children[items.indexOf(target)];
    if (row instanceof HTMLElement) row.scrollIntoView?.({ block: "nearest" });
  };

  const actions = {
    retry: () => {
      focusList();
      if (focused?.status === "failed" && !retry.isPending) retry.mutate(focused);
    },
    toggleExcluded: () => {
      focusList();
      if (focused && !exclude.isPending) exclude.mutate(focused);
    },
    ask: () => {
      if (subject) openAgentPanel({ subject });
    },
    canAsk: subject !== null,
    toggleLog: () => {
      focusList();
      if (focused?.hasLog) setShowLog((current) => !current);
    },
    retrying: retry.isPending,
  };

  // 1-5 switch tabs from anywhere in the view except text fields.
  function onRootKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
    if (/^[1-5]$/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      selectTab(Number(event.key) - 1);
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== listRef.current || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.key === "ArrowDown") move(focusedIndex + 1);
    else if (event.key === "ArrowUp") move(focusedIndex - 1);
    else if (key === "o" && focused) (event.shiftKey ? openEntryInBrowser : openEntryInApp)(focused);
    else if (key === "r") actions.retry();
    else if ((key === "x" && !focused?.excluded) || (key === "u" && focused?.excluded)) actions.toggleExcluded();
    else if (key === "l") actions.toggleLog();
    else if (key === "q") actions.ask();
    else if (event.key === "Enter" && focused) setResultRequest((n) => n + 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  if (workQuery.isLoading) return <LoadingState />;
  if (workQuery.isError) {
    return <ErrorState message={commandErrorMessage(workQuery.error)} onRetry={() => void workQuery.refetch()} />;
  }

  const listPane = (
    <div
      ref={attachList}
      data-primary-grid="true"
      role="listbox"
      aria-label={`${activeTab.label} agent work`}
      tabIndex={0}
      onKeyDown={onListKeyDown}
      className="h-full min-h-0 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      {items.length === 0 && <PreviewEmptyState message="Nothing here." />}
      {items.map((item) => {
        const key = agentWorkKey(item);
        const isFocused = focused !== null && key === agentWorkKey(focused);
        const isUnread = item.status === "succeeded" && !seen.includes(seenKey(item));
        return (
          <div
            key={key}
            role="option"
            aria-selected={isFocused}
            onClick={() => {
              setFocusKey(key);
              focusList();
            }}
            className={`grid cursor-default grid-cols-[64px_24px_1fr_auto_64px] items-center gap-2 border-b border-border px-3 py-1 text-sm ${
              isFocused ? "bg-primary/10 outline outline-2 -outline-offset-2 outline-primary" : ""
            }`}
          >
            <StatusBadge status={item.status} />
            <span className={`text-xs font-bold ${item.target === "pull-request" ? "text-link" : "text-success"}`}>
              {item.target === "pull-request" ? "PR" : "WI"}
            </span>
            <span className={`truncate ${isUnread ? "font-semibold" : ""}`}>
              <span className="text-muted-foreground tabular-nums">
                {item.target === "pull-request" ? "!" : "#"}
                {item.id}
              </span>{" "}
              {item.title}
            </span>
            <span className="max-w-32 truncate text-xs text-muted-foreground">{item.scope}</span>
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              {item.status === "failed" && item.failures > 1
                ? `${item.failures} tries`
                : timeLabel(item.finishedAt ?? item.startedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );

  const count = (tab: AgentWorkTab) => entries.filter(tab.matches).length;
  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onRootKeyDown}>
      <div role="tablist" aria-label="Agent work" className="flex h-7 shrink-0 items-end gap-0.5 border-b border-border px-2">
        {TABS.map((tab, index) => {
          const selected = tab.id === activeTab.id;
          const n = count(tab);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-keyshortcuts={String(index + 1)}
              title={`${tab.label} (${index + 1})`}
              tabIndex={-1}
              onClick={() => selectTab(index)}
              className={`h-full border-b-2 px-2.5 text-xs ${
                selected ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.id !== "candidates" ? (
                <span className={`ml-1 tabular-nums ${tab.id === "attention" && n > 0 ? "font-bold text-destructive" : ""}`}>
                  {n}
                  {tab.id === "results" && unread > 0 ? ` (${unread} new)` : ""}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {activeTab.id === "candidates" ? (
        <div className="min-h-0 flex-1">
          <AutoQueueView />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <DockableWorkspace
            storageKey="azdodeck:agentWork:dockview:v1"
            activatePanel={resultRequest > 0 ? { id: "result", key: resultRequest } : undefined}
            panels={[
              { id: "list", title: "Items", content: listPane, minWidth: 360 },
              {
                id: "details",
                title: "Details",
                content: <AgentWorkPreview entry={focused} showLog={showLog} actions={actions} />,
                position: { relativeTo: "list", direction: "right" },
                minWidth: 320,
              },
              {
                // Tabbed with Details by default; drag it (or use the move
                // menu) into its own split or a floating window.
                id: "result",
                title: "Result",
                content: <AgentWorkResult entry={focused} />,
                position: { relativeTo: "details", direction: "within" },
                minWidth: 320,
              },
            ] satisfies DockablePanelSpec[]}
          />
        </div>
      )}

      <div className="flex shrink-0 flex-wrap gap-4 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span>1–5 tabs</span>
        {activeTab.id === "candidates" ? null : (
          <>
            <span>↑↓ move</span>
            <span>O open in DevDeck</span>
            <span>Shift+O open in Azure DevOps</span>
            <span>R retry failed</span>
            <span>X exclude / U include</span>
            <span>Q ask the agent</span>
            <span>L log</span>
            <span>Enter show Result</span>
          </>
        )}
      </div>
    </div>
  );
}
