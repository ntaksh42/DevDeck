import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  autoQueueKey,
  commandErrorMessage,
  getAutoQueuePreview,
  listAutoQueue,
  runAutoQueue,
  setAgentWorkExcluded,
  type AutoQueueItem,
  type AutoQueueTarget,
} from "@/lib/azdoCommands";
import { subscribeTauriEvent } from "@/lib/tauriEvents";
import { pushNotice, pushToast } from "@/lib/toast";
import { clamp, focusFilterInput } from "@/lib/utils";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { ListStatusBar } from "@/components/ListStatusBar";
import { DockFilterBar, DockFilterInput, useDockFilter } from "@/components/DockFilterBar";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { HeaderToolbarPortal } from "@/components/HeaderToolbarSlot";

const QUEUE_KEY = ["autoQueue"];

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k tok` : `${tokens} tok`;
}

function ageLabel(createdDate: string | null): string {
  const time = createdDate ? Date.parse(createdDate) : NaN;
  if (Number.isNaN(time)) return "";
  const days = Math.floor((Date.now() - time) / 86_400_000);
  return days <= 0 ? "today" : `${days}d`;
}

/** `tabs`: Agent Work's tab segments, shown at the start of the list tab band. */
export function AutoQueueView({ tabs }: { tabs?: ReactNode }) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const rangeAnchor = useRef<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const filter = useDockFilter(filterInputRef, () => listRef.current?.focus());

  const queueQuery = useQuery({ queryKey: QUEUE_KEY, queryFn: listAutoQueue });

  // Items just handed to the agent stay hidden until the next sync: their notes
  // folder appears only after the backend gathered the material.
  const [started, setStarted] = useState<string[]>([]);

  useEffect(
    () =>
      subscribeTauriEvent("sync:updated", () => {
        setStarted([]);
        void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      }),
    [queryClient],
  );

  const allItems = useMemo(
    () =>
      (queueQuery.data ?? []).filter((item) => !started.includes(autoQueueKey(item))),
    [queueQuery.data, started],
  );
  // The filter narrows the list; only the rows shown can be selected and run.
  const items = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return allItems;
    return allItems.filter((item) => {
      const prefix = item.target === "pull-request" ? "!" : "#";
      const text = `${prefix}${item.id} ${item.id} ${item.title} ${item.scope} ${item.organizationName}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [allItems, query]);
  const focused = items.find((item) => autoQueueKey(item) === focusKey) ?? items[0] ?? null;
  const focusedIndex = focused ? items.indexOf(focused) : -1;
  const selected = items.filter((item) => checked.has(autoQueueKey(item)));
  const allSelected = items.length > 0 && selected.length === items.length;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.length > 0 && !allSelected;
  }, [selected.length, allSelected]);

  const previewQuery = useQuery({
    queryKey: ["autoQueuePreview", focused ? autoQueueKey(focused) : null],
    queryFn: () => getAutoQueuePreview(focused!),
    enabled: focused !== null,
    staleTime: 5 * 60_000,
  });

  const runMutation = useMutation({
    mutationFn: (targets: AutoQueueTarget[]) => runAutoQueue(targets),
    onSuccess: (count, targets) => {
      pushNotice(`${count} handed to the agent. Results appear in the Agent panel and the result folders.`);
      setStarted((current) => [...current, ...targets.map(autoQueueKey)]);
      setChecked(new Set());
      void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
    onError: (error) => pushToast(commandErrorMessage(error)),
  });

  // The list owns the keyboard: it takes focus on open and gets it back after
  // a button was used, so arrow navigation resumes. It lives in a dock panel
  // that mounts after this view, so it takes focus when it attaches.
  const wantsFocusRef = useRef(true);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    if (element && wantsFocusRef.current) {
      wantsFocusRef.current = false;
      // Arrowing between tabs hands focus to the tab segment; keep it there.
      if (!document.activeElement?.closest('[role="tablist"][aria-label="Agent work"]')) element.focus();
    }
  }, []);
  useEffect(() => {
    if (document.activeElement?.closest('[role="tablist"][aria-label="Agent work"]')) return;
    if (listRef.current) listRef.current.focus();
    else wantsFocusRef.current = true;
  }, [queueQuery.isLoading]);

  const run = useCallback(() => {
    listRef.current?.focus();
    if (selected.length > 0 && !runMutation.isPending) runMutation.mutate(selected);
  }, [selected, runMutation]);

  // Excluded items leave this list and are never started automatically; the
  // Runs list of Agent Work shows them as excluded, and X there includes them again.
  const excludeMutation = useMutation({
    mutationFn: (targets: AutoQueueItem[]) => Promise.all(targets.map((item) => setAgentWorkExcluded(item, true))),
    onSuccess: (_, targets) => {
      pushNotice(`${targets.length} excluded from automatic runs.`);
      setStarted((current) => [...current, ...targets.map(autoQueueKey)]);
      setChecked(new Set());
      void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
      void queryClient.invalidateQueries({ queryKey: ["agentWork"] });
    },
    onError: (error) => pushToast(commandErrorMessage(error)),
  });

  const exclude = useCallback(() => {
    listRef.current?.focus();
    const targets = selected.length > 0 ? selected : focused ? [focused] : [];
    if (targets.length > 0 && !excludeMutation.isPending) excludeMutation.mutate(targets);
  }, [selected, focused, excludeMutation]);

  const toggle = useCallback((item: AutoQueueItem) => {
    setChecked((current) => {
      const next = new Set(current);
      const key = autoQueueKey(item);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const move = useCallback(
    (index: number) => {
      const target = items[clamp(index, 0, items.length - 1)];
      if (!target) return;
      setFocusKey(autoQueueKey(target));
      const row = listRef.current?.children[items.indexOf(target)];
      if (row instanceof HTMLElement) row.scrollIntoView?.({ block: "nearest" });
    },
    [items],
  );

  const toggleAll = useCallback(() => {
    setChecked((current) => {
      const next = new Set(current);
      const keys = items.map(autoQueueKey);
      if (keys.every((key) => next.has(key))) keys.forEach((key) => next.delete(key));
      else keys.forEach((key) => next.add(key));
      return next;
    });
  }, [items]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      run();
      return;
    }
    if (event.target !== listRef.current || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!focused) return;
      const nextIndex = clamp(focusedIndex + (event.key === "ArrowDown" ? 1 : -1), 0, items.length - 1);
      if (event.shiftKey) {
        const keys = items.map(autoQueueKey);
        const previousAnchor = rangeAnchor.current === null ? -1 : keys.indexOf(rangeAnchor.current);
        const anchorIndex = previousAnchor < 0 ? focusedIndex : previousAnchor;
        rangeAnchor.current = keys[anchorIndex];
        const range = keys.slice(Math.min(anchorIndex, nextIndex), Math.max(anchorIndex, nextIndex) + 1);
        setChecked((current) => {
          const next = new Set(current);
          keys.forEach((key) => next.delete(key));
          range.forEach((key) => next.add(key));
          return next;
        });
      } else {
        rangeAnchor.current = null;
      }
      move(nextIndex);
      return;
    }
    rangeAnchor.current = null;
    switch (event.key) {
      case " ":
        if (focused) toggle(focused);
        break;
      case "a":
      case "A":
        toggleAll();
        break;
      case "x":
      case "X":
        exclude();
        break;
      case "/":
        focusFilterInput();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const totalTokens = previewQuery.data && focused && checked.size <= 1 ? previewQuery.data.estimatedTokens : null;

  if (queueQuery.isLoading) return <LoadingState />;
  if (queueQuery.isError) return <ErrorState message={commandErrorMessage(queueQuery.error)} onRetry={() => void queueQuery.refetch()} />;

  const listPane = (
    <div className="flex h-full min-h-0 flex-col">
      <label className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-0.5 text-xs text-muted-foreground">
        <input
          ref={selectAllRef}
          type="checkbox"
          tabIndex={-1}
          aria-label="Select all shown"
          checked={allSelected}
          disabled={items.length === 0}
          onChange={() => {
            toggleAll();
            listRef.current?.focus();
          }}
          className="h-3.5 w-3.5"
        />
        Select all shown <kbd>A</kbd>
      </label>
      <div
        ref={attachList}
        data-primary-grid="true"
        role="listbox"
        aria-label="Auto queue candidates"
        aria-multiselectable="true"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {items.length === 0 && (
          allItems.length > 0 ? (
            <PreviewEmptyState message="No candidates match the filter." />
          ) : (
            <PreviewEmptyState message="Nothing is waiting." hint="New pull requests and work items appear here after a sync." />
          )
        )}
        {items.map((item) => {
          const key = autoQueueKey(item);
          const isFocused = focused !== null && key === autoQueueKey(focused);
          return (
            <div
              key={key}
              role="option"
              aria-selected={checked.has(key)}
              onClick={() => {
                rangeAnchor.current = null;
                setFocusKey(key);
              }}
              className={`grid cursor-default grid-cols-[22px_34px_1fr_auto_auto] items-center gap-2 border-b border-border px-3 py-1 text-sm ${
                isFocused ? "bg-primary/10 outline outline-2 -outline-offset-2 outline-primary" : ""
              }`}
            >
              <input
                type="checkbox"
                tabIndex={-1}
                aria-label={`Select ${item.title}`}
                checked={checked.has(key)}
                onChange={() => toggle(item)}
                className="h-3.5 w-3.5"
              />
              <span className={`text-xs font-bold ${item.target === "pull-request" ? "text-link" : "text-success"}`}>
                {item.target === "pull-request" ? "PR" : "WI"}
              </span>
              <span className="truncate">
                <span className="text-muted-foreground">{item.target === "pull-request" ? "!" : "#"}{item.id}</span> {item.title}
              </span>
              <span className="max-w-32 truncate text-xs text-muted-foreground">{item.scope}</span>
              <span className="w-10 text-right text-xs text-muted-foreground">{ageLabel(item.createdDate)}</span>
            </div>
          );
        })}
      </div>
      <ListStatusBar
        summary={[
          query.trim() ? `${items.length} of ${allItems.length} not run yet` : `${items.length} not run yet`,
          `${selected.length} selected`,
          totalTokens !== null && `focused ≈ ${formatTokens(totalTokens)}`,
        ]}
        helpSection="agent-work"
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <HeaderToolbarPortal>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-secondary disabled:opacity-50"
          onClick={exclude}
          disabled={items.length === 0 || excludeMutation.isPending}
          title="Exclude the focused candidate from automatic runs (X)"
        >
          Exclude <kbd className="text-muted-foreground">X</kbd>
        </button>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          onClick={run}
          disabled={selected.length === 0 || runMutation.isPending}
          title="Run the checked candidates now. Eligible items also run automatically when enabled in Settings."
        >
          Run selected <kbd className="opacity-80">Ctrl+Enter</kbd>
        </button>
      </HeaderToolbarPortal>
      <div className="flex min-h-0 flex-1">
        <DockableWorkspace
          storageKey="azdodeck:agentWorkCandidates:dockview:v1"
          panels={[
            {
              id: "list",
              title: "Items",
              headerActions: (
                <>
                  {tabs}
                  <DockFilterBar
                    label="Filter candidates"
                    open={filter.open}
                    onOpen={filter.onOpen}
                    onClose={filter.onClose}
                    inputRef={filterInputRef}
                    hasValue={query.trim() !== ""}
                    chips={query.trim() ? [{ label: query.trim(), onClear: () => setQuery("") }] : []}
                  >
                    <DockFilterInput
                      inputRef={filterInputRef}
                      value={query}
                      onChange={setQuery}
                      placeholder="Filter by number, title, repository…"
                      ariaLabel="Filter candidates"
                    />
                  </DockFilterBar>
                </>
              ),
              content: listPane,
              minWidth: 420,
            },
            {
              id: "preview",
              title: "Preview",
              content: (
                <div className="h-full min-h-0 overflow-auto p-3 text-sm">
          {focused === null ? (
            <PreviewEmptyState message="Pick a candidate to see what the agent would get." />
          ) : (
            <>
              <h2 className="text-base font-semibold leading-snug">
                {focused.target === "pull-request" ? "!" : "#"}
                {focused.id} {focused.title}
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">
                {focused.organizationName} · {focused.scope}
              </p>
              {previewQuery.isLoading && <LoadingState />}
              {previewQuery.isError && <p className="text-destructive">{commandErrorMessage(previewQuery.error)}</p>}
              {previewQuery.data?.unavailable && <p className="text-warning">{previewQuery.data.unavailable}</p>}
              {previewQuery.data && !previewQuery.data.unavailable && (
                <>
                  <h3 className="mb-1 flex items-baseline gap-2 rounded border-l-4 border-l-primary bg-info/10 px-1.5 py-0.5 text-sm font-semibold leading-5 text-foreground">
                    Material
                    <span className="text-xs font-normal text-muted-foreground">
                      {previewQuery.data.chars.toLocaleString()} chars ≈ {formatTokens(previewQuery.data.estimatedTokens)}
                      {previewQuery.data.chars > previewQuery.data.document.length && " (start shown)"}
                    </span>
                  </h3>
                  <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 text-xs">
                    {previewQuery.data.document}
                  </pre>
                </>
              )}
            </>
          )}
                </div>
              ),
              position: { relativeTo: "list", direction: "right" },
              minWidth: 320,
            },
          ] satisfies DockablePanelSpec[]}
        />
      </div>
    </div>
  );
}
