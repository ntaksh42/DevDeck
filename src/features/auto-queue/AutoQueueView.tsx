import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  autoQueueKey,
  commandErrorMessage,
  getAppSettings,
  getAutoQueuePreview,
  listAutoQueue,
  runAutoQueue,
  type AutoQueueItem,
  type AutoQueueTarget,
} from "@/lib/azdoCommands";
import { subscribeTauriEvent } from "@/lib/tauriEvents";
import { pushToast } from "@/lib/toast";
import { clamp } from "@/lib/utils";
import { ErrorState, LoadingState, PreviewEmptyState } from "@/components/StateDisplay";
import { addSkipped, clearSkipped, loadSkipped } from "./autoQueueSkipped";

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

/**
 * `onDecided` receives the items the user just ran or skipped. With `sessionOnly`
 * (the startup dialog) skips are kept in memory for this launch instead of
 * localStorage, so an item skipped there asks again at the next start.
 */
export function AutoQueueView({
  onDecided,
  sessionOnly = false,
}: { onDecided?: (targets: AutoQueueTarget[]) => void; sessionOnly?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [skipped, setSkipped] = useState<string[]>(sessionOnly ? [] : loadSkipped);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const settingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings });
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

  const items = useMemo(
    () =>
      (queueQuery.data ?? []).filter((item) => {
        const key = autoQueueKey(item);
        return !skipped.includes(key) && !started.includes(key);
      }),
    [queueQuery.data, skipped, started],
  );
  const focused = items.find((item) => autoQueueKey(item) === focusKey) ?? items[0] ?? null;
  const focusedIndex = focused ? items.indexOf(focused) : -1;
  const selected = items.filter((item) => checked.has(autoQueueKey(item)));

  const previewQuery = useQuery({
    queryKey: ["autoQueuePreview", focused ? autoQueueKey(focused) : null],
    queryFn: () => getAutoQueuePreview(focused!),
    enabled: focused !== null,
    staleTime: 5 * 60_000,
  });

  const runMutation = useMutation({
    mutationFn: (targets: AutoQueueTarget[]) => runAutoQueue(targets),
    onSuccess: (count, targets) => {
      pushToast(`${count} handed to the agent. Results appear in the Agent panel and the result folders.`);
      setStarted((current) => [...current, ...targets.map(autoQueueKey)]);
      onDecided?.(targets);
      setChecked(new Set());
      void queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    },
    onError: (error) => pushToast(commandErrorMessage(error)),
  });

  // The list owns the keyboard: it takes focus on open and gets it back after
  // a button was used, so arrow navigation resumes.
  useEffect(() => listRef.current?.focus(), [queueQuery.isLoading]);

  const run = useCallback(() => {
    listRef.current?.focus();
    if (selected.length > 0 && !runMutation.isPending) runMutation.mutate(selected);
  }, [selected, runMutation]);

  const skip = useCallback(() => {
    listRef.current?.focus();
    const targets = selected.length > 0 ? selected : focused ? [focused] : [];
    if (targets.length === 0) return;
    setSkipped((current) =>
      sessionOnly ? [...new Set([...current, ...targets.map(autoQueueKey)])] : addSkipped(current, targets),
    );
    setChecked(new Set());
    onDecided?.(targets);
  }, [selected, focused, onDecided, sessionOnly]);

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

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      run();
      return;
    }
    if (event.target !== listRef.current || event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
        move(focusedIndex + 1);
        break;
      case "ArrowUp":
        move(focusedIndex - 1);
        break;
      case " ":
        if (focused) toggle(focused);
        break;
      case "a":
      case "A":
        setChecked(selected.length === items.length ? new Set() : new Set(items.map(autoQueueKey)));
        break;
      case "s":
      case "S":
        skip();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const totalTokens = previewQuery.data && focused && checked.size <= 1 ? previewQuery.data.estimatedTokens : null;
  const approval = settingsQuery.data?.autoAgentApprovalEnabled ?? false;

  if (queueQuery.isLoading) return <LoadingState />;
  if (queueQuery.isError) return <ErrorState message={commandErrorMessage(queueQuery.error)} onRetry={() => void queueQuery.refetch()} />;

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-1.5 text-sm">
        <h1 className="font-semibold">Auto queue</h1>
        <span className="text-muted-foreground">
          {items.length} waiting · {selected.length} selected
          {totalTokens !== null && ` · focused ≈ ${formatTokens(totalTokens)}`}
        </span>
        {!approval && (
          <span className="text-xs text-warning">
            Items found at app start wait here for a pick; later ones run automatically. Turn on “Choose what to run in Auto queue first” (Settings → Agent command) to pick every time.
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
          onClick={() => setSkipped(sessionOnly ? [] : clearSkipped())}
          disabled={skipped.length === 0}
        >
          Show skipped ({skipped.length})
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
          onClick={skip}
          disabled={items.length === 0}
        >
          Skip <kbd className="text-muted-foreground">S</kbd>
        </button>
        <button
          type="button"
          className="rounded bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          onClick={run}
          disabled={selected.length === 0 || runMutation.isPending}
        >
          Run selected <kbd className="opacity-80">Ctrl+Enter</kbd>
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div
          ref={listRef}
          data-primary-grid="true"
          role="listbox"
          aria-label="Auto queue candidates"
          aria-multiselectable="true"
          tabIndex={0}
          className="min-h-0 overflow-auto border-r border-border outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {items.length === 0 && (
            <PreviewEmptyState message="Nothing is waiting." hint="New pull requests and work items appear here after a sync." />
          )}
          {items.map((item) => {
            const key = autoQueueKey(item);
            const isFocused = focused !== null && key === autoQueueKey(focused);
            return (
              <div
                key={key}
                role="option"
                aria-selected={checked.has(key)}
                onClick={() => setFocusKey(key)}
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

        <div className="min-h-0 overflow-auto p-3 text-sm">
          {focused === null ? (
            <PreviewEmptyState message="Pick a candidate to see what the agent would get." />
          ) : (
            <>
              <h2 className="font-semibold">
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
                  <p className="mb-1 text-xs text-muted-foreground">
                    Material: {previewQuery.data.chars.toLocaleString()} chars ≈ {formatTokens(previewQuery.data.estimatedTokens)}
                    {previewQuery.data.chars > previewQuery.data.document.length && " (start shown)"}
                  </p>
                  <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 text-xs">
                    {previewQuery.data.document}
                  </pre>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span>↑↓ move</span>
        <span>Space select</span>
        <span>A select all</span>
        <span>S skip</span>
        <span>Ctrl+Enter run selected</span>
      </div>
    </div>
  );
}
