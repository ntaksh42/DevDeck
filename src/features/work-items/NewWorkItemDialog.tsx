import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import {
  createWorkItem,
  listWorkItemTypes,
  searchWorkItemAssignees,
  commandErrorMessage,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { workItemQueryKeys, invalidateWorkItemMutationCaches } from "./queryKeys";

const PRIORITIES = [1, 2, 3, 4];

export function NewWorkItemDialog({
  organizationId,
  projectId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  projectId: string;
  // Called with the created summary so the panel can refresh and open it.
  onCreated: (item: WorkItemSummary) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState("");
  const [workItemType, setWorkItemType] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assignValue, setAssignValue] = useState("");
  const [areaPath, setAreaPath] = useState("");
  const [iterationPath, setIterationPath] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const typesQuery = useQuery({
    queryKey: ["workItemTypes", organizationId, projectId],
    queryFn: () => listWorkItemTypes({ organizationId, projectId }),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
  const types = typesQuery.data ?? [];

  // Default the type to the first available once loaded.
  useEffect(() => {
    if (!workItemType && types.length > 0) {
      setWorkItemType(types.find((t) => t.name === "Task")?.name ?? types[0].name);
    }
  }, [types, workItemType]);

  const debouncedAssignee = useDebouncedValue(assigneeQuery, 200);
  const assigneesQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(organizationId, projectId, 0, debouncedAssignee),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId,
        projectId,
        workItemId: 0,
        query: debouncedAssignee,
      }),
    enabled: !!projectId && debouncedAssignee.trim().length > 0,
    staleTime: 60_000,
  });
  const assigneeOptions = assigneesQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: createWorkItem,
    onSuccess: (item) => {
      invalidateWorkItemMutationCaches(queryClient);
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.myItems(organizationId) });
      onCreated(item);
    },
  });

  const canSubmit = title.trim().length > 0 && !!workItemType && !mutation.isPending;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({
      organizationId,
      projectId,
      workItemType,
      title: title.trim(),
      assignedTo: assignValue.trim() || undefined,
      priority: priority ? Number(priority) : undefined,
      areaPath: areaPath.trim() || undefined,
      iterationPath: iterationPath.trim() || undefined,
      tags: tags.trim() || undefined,
    });
  }

  const field = "flex flex-col gap-1";
  const label = "text-xs font-medium text-muted-foreground";
  const control =
    "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  const assigneeListId = useMemo(() => `new-wi-assignees-${Math.random().toString(36).slice(2)}`, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        // Contain navigation/activation keys so the underlying grid does not react.
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-wi-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between">
          <h2 id="new-wi-title" className="flex items-center gap-2 text-base font-semibold">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Work Item
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className={field}>
          <label className={label} htmlFor="new-wi-title-input">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            id="new-wi-title-input"
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="What needs to be done?"
            className={control}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={field}>
            <label className={label} htmlFor="new-wi-type">Type</label>
            <select
              id="new-wi-type"
              value={workItemType}
              onChange={(e) => setWorkItemType(e.target.value)}
              disabled={typesQuery.isLoading}
              className={`${control} disabled:opacity-60`}
            >
              {types.length === 0 ? <option value="">Loading…</option> : null}
              {types.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className={field}>
            <label className={label} htmlFor="new-wi-priority">Priority</label>
            <select
              id="new-wi-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={control}
            >
              <option value="">Default</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={field}>
          <label className={label} htmlFor="new-wi-assignee">Assigned to</label>
          <input
            id="new-wi-assignee"
            list={assigneeListId}
            value={assigneeQuery}
            onChange={(e) => {
              const next = e.target.value;
              setAssigneeQuery(next);
              const match = assigneeOptions.find((o) => o.assignValue === next || o.displayName === next);
              setAssignValue(match ? match.assignValue : next);
            }}
            placeholder="Search by name or email…"
            className={control}
          />
          <datalist id={assigneeListId}>
            {assigneeOptions.map((o) => (
              <option key={o.id} value={o.assignValue}>{o.displayName}</option>
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={field}>
            <label className={label} htmlFor="new-wi-area">Area path</label>
            <input
              id="new-wi-area"
              value={areaPath}
              onChange={(e) => setAreaPath(e.target.value)}
              placeholder="Optional"
              className={control}
            />
          </div>
          <div className={field}>
            <label className={label} htmlFor="new-wi-iteration">Iteration path</label>
            <input
              id="new-wi-iteration"
              value={iterationPath}
              onChange={(e) => setIterationPath(e.target.value)}
              placeholder="Optional"
              className={control}
            />
          </div>
        </div>

        <div className={field}>
          <label className={label} htmlFor="new-wi-tags">Tags</label>
          <input
            id="new-wi-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Semicolon-separated"
            className={control}
          />
        </div>

        {mutation.isError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
