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
import { pushNotice, pushToast } from "@/lib/toast";
import { clamp, isEditableTarget } from "@/lib/utils";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { ListStateChip, ListStatusBar, itemCount } from "@/components/ListStatusBar";
import { AutoQueueView } from "./AutoQueueView";
import { AgentWorkPreview, AgentWorkResult } from "./AgentWorkPreview";
import { openEntryInApp, openEntryInBrowser } from "./AgentWorkLinks";
import { agentWorkSubject, sortRuns, StatusBadge, TABS, timeLabel, type AgentWorkTab } from "./agentWorkStatus";
import { AgentWorkTabs } from "./AgentWorkTabs";
import { openAgentPanel, usePublishAgentSubject } from "@/components/agent/agentSubject";

const WORK_KEY = ["agentWork"];

export function AgentWorkView() {
  const queryClient = useQueryClient();
  const workQuery = useQuery({ queryKey: WORK_KEY, queryFn: listAgentWork, refetchInterval: 10_000 });
  const entries = useMemo(() => workQuery.data ?? [], [workQuery.data]);
  const [tabId, setTabId] = useState<AgentWorkTab["id"] | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Runs lists what is still open; finished (Done) runs sit behind this view.
  const [doneView, setDoneView] = useState(false);
  // Bumped to bring the Result panel's tab to the front.
  const [resultRequest, setResultRequest] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => subscribeTauriEvent("sync:updated", () => void queryClient.invalidateQueries({ queryKey: WORK_KEY })),
    [queryClient],
  );

  // One Runs list, ordered so what needs a decision comes first.
  const activeTab = TABS.find((tab) => tab.id === tabId) ?? TABS[0];
  const doneCount = entries.filter((entry) => entry.status === "succeeded").length;
  const items = useMemo(() => {
    if (activeTab.id !== "runs") return [];
    return sortRuns(entries.filter((entry) => (entry.status === "succeeded") === doneView));
  }, [entries, activeTab, doneView]);
  const focused = items.find((item) => agentWorkKey(item) === focusKey) ?? items[0] ?? null;
  const focusedIndex = focused ? items.indexOf(focused) : -1;
  // The Agent panel follows the selected item, so questions go to its conversation.
  const subject = focused && activeTab.id !== "candidates" ? agentWorkSubject(focused) : null;
  usePublishAgentSubject(subject);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: WORK_KEY });
    void queryClient.invalidateQueries({ queryKey: ["autoQueue"] });
  }, [queryClient]);

  const retry = useMutation({
    mutationFn: retryAgentWork,
    onSuccess: () => {
      pushNotice("Retrying now. It runs after the agent's current run finishes.");
      refresh();
    },
    onError: (error) => pushToast(commandErrorMessage(error)),
  });
  const exclude = useMutation({
    mutationFn: (entry: AgentWorkEntry) => setAgentWorkExcluded(entry, !entry.excluded),
    onSuccess: (_, entry) => {
      pushNotice(entry.excluded ? "Included in automatic runs again." : "Excluded from automatic runs.");
      refresh();
    },
    onError: (error) => pushToast(commandErrorMessage(error)),
  });

  // On Candidates the list belongs to AutoQueueView, so fall back to the primary grid.
  const focusList = () => (listRef.current ?? document.querySelector<HTMLElement>("[data-primary-grid='true']"))?.focus();
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
    // Arrowing through the tab segments keeps focus there; 1-2 and clicks land on the list.
    if (document.activeElement?.closest('[role="tablist"][aria-label="Agent work"]')) return;
    if (listRef.current) listRef.current.focus();
    else wantsFocusRef.current = true;
  }, [workQuery.isLoading, activeTab.id]);

  const selectTab = (index: number) => {
    const tab = TABS[index];
    if (!tab) return;
    setTabId(tab.id);
    setFocusKey(null);
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
    retrying: retry.isPending,
  };

  // 1-2 switch tabs from anywhere in the view except text fields.
  function onRootKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
    if (new RegExp(`^[1-${TABS.length}]$`).test(event.key)) {
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
    else if (key === "x") actions.toggleExcluded();
    else if (key === "d") setDoneView((current) => !current);
    else if (event.key === "Escape" && doneView) setDoneView(false);
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
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={attachList}
        data-primary-grid="true"
        role="listbox"
        aria-label={`${activeTab.label} agent work`}
        tabIndex={0}
        onKeyDown={onListKeyDown}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {items.length === 0 && <PreviewEmptyState message="Nothing here." />}
        {items.map((item) => {
          const key = agentWorkKey(item);
          const isFocused = focused !== null && key === agentWorkKey(focused);
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
              <span className="truncate">
                <span className="text-muted-foreground tabular-nums">
                  {item.target === "pull-request" ? "!" : "#"}
                  {item.id}
                </span>{" "}
                {item.title}
                {item.excluded && <span className="ml-1 text-xs text-muted-foreground">(excluded)</span>}
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
      <ListStatusBar
        summary={[itemCount(items.length, doneView ? "done" : "")]}
        done={{ count: doneCount, active: doneView, onToggle: () => setDoneView((current) => !current) }}
        helpSection="agent-work"
      />
    </div>
  );

  const tabs = (
    <AgentWorkTabs
      activeId={activeTab.id}
      entries={entries}
      onSelect={selectTab}
      onFocusList={focusList}
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onRootKeyDown}>
      {activeTab.id === "candidates" ? (
        <div className="min-h-0 flex-1">
          <AutoQueueView tabs={tabs} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <DockableWorkspace
            storageKey="azdodeck:agentWork:dockview:v1"
            activatePanel={resultRequest > 0 ? { id: "result", key: resultRequest } : undefined}
            panels={[
              {
                id: "list",
                title: "Items",
                headerActions: (
                  <>
                    {tabs}
                    {doneView ? <ListStateChip label="Done" onClear={() => setDoneView(false)} /> : null}
                  </>
                ),
                content: listPane,
                minWidth: 420,
              },
              {
                id: "details",
                title: "Details",
                content: <AgentWorkPreview entry={focused} actions={actions} />,
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
    </div>
  );
}
