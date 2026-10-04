import { Play } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { FilterableSelect } from "./FilterableSelect";
import type { useQueueRunForm } from "./useQueueRunForm";

type QueueForm = ReturnType<typeof useQueueRunForm>;

const INPUT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

// Queue-run form as a popover under the toolbar, so opening it does not push the
// grid down. It opens on the Branch control, Ctrl+Enter queues, Esc closes, and
// the owner returns focus to the "Queue run" button when `onClose(true)` fires.
export function PipelineQueuePopover({
  form,
  definitionName,
  onClose,
}: {
  form: QueueForm;
  definitionName: string | undefined;
  /** `returnFocus` is false when the user clicked elsewhere. */
  onClose: (returnFocus: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const {
    queueBranch,
    setQueueBranch,
    queueParams,
    setQueueParams,
    queueParamValues,
    setQueueParamValues,
    queueError,
    showQueueBranchSelect,
    queueBranchOptions,
    queueBranchesQuery,
    overridableVariables,
    queueMutation,
    submitQueue,
  } = form;

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-queue-first] input, [data-queue-first] button")?.focus();
  }, []);

  // Clicking anywhere outside dismisses the popover without stealing focus.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (rootRef.current?.contains(target) || target?.closest("[data-queue-trigger]")) return;
      onClose(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose]);

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      if (!queueMutation.isPending && queueBranch.trim()) submitQueue();
    } else if (event.key.startsWith("Arrow")) {
      // Keep arrows inside the popover so the grid underneath does not react.
      event.stopPropagation();
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`Queue ${definitionName ?? "run"}`}
      onKeyDown={handleKeyDown}
      className="absolute right-2 top-full z-30 mt-1 grid w-[360px] max-w-[calc(100%-1rem)] gap-2 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <p className="text-sm font-medium">Queue {definitionName}</p>
      <label className="grid gap-1" data-queue-first>
        <span className="text-xs text-muted-foreground">Branch</span>
        {showQueueBranchSelect ? (
          <FilterableSelect
            ariaLabel="Branch"
            value={queueBranch}
            options={queueBranchOptions}
            disabled={queueBranchesQuery.isLoading}
            placeholder={queueBranchesQuery.isLoading ? "Loading branches…" : "Select a branch"}
            allowCustomValue
            onChange={setQueueBranch}
          />
        ) : (
          <input
            value={queueBranch}
            onChange={(event) => setQueueBranch(event.target.value)}
            placeholder="main"
            aria-label="Branch"
            className={INPUT_CLASS}
          />
        )}
      </label>
      {overridableVariables.length > 0 ? (
        <div className="grid gap-2">
          {overridableVariables.map((variable) => (
            <label key={variable.name} className="grid gap-1">
              <span className="text-xs text-muted-foreground">{variable.name}</span>
              <input
                type={variable.isSecret ? "password" : "text"}
                value={queueParamValues[variable.name] ?? ""}
                onChange={(event) =>
                  setQueueParamValues((prev) => ({ ...prev, [variable.name]: event.target.value }))
                }
                placeholder={variable.isSecret ? "Secret value" : undefined}
                aria-label={variable.name}
                className={INPUT_CLASS}
              />
            </label>
          ))}
        </div>
      ) : null}
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">
          {overridableVariables.length > 0
            ? "Additional parameters (one name=value per line, optional)"
            : "Parameters (one name=value per line, optional)"}
        </span>
        <textarea
          value={queueParams}
          onChange={(event) => setQueueParams(event.target.value)}
          rows={3}
          placeholder={"environment=prod\nrunTests=true"}
          aria-label="Parameters"
          className="resize-y rounded-md border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onClose(true)}
          aria-keyshortcuts="Escape"
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submitQueue}
          disabled={queueMutation.isPending || !queueBranch.trim()}
          aria-keyshortcuts="Control+Enter"
          title="Queue (Ctrl+Enter)"
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Queue
        </button>
      </div>
      {queueError ? (
        <p role="alert" className="text-xs text-destructive">
          {queueError}
        </p>
      ) : null}
    </div>
  );
}
