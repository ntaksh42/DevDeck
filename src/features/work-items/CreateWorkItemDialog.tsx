import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import {
  commandErrorMessage,
  createWorkItem,
  listClassificationNodes,
  listWorkItemProjects,
  listWorkItemTypes,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { invalidateWorkItemMutationCaches, workItemQueryKeys } from "./queryKeys";

/**
 * Seed values for the create form. All fields are optional: the "New item"
 * button opens an empty form, templates prefill type/priority/paths/tags, and
 * Duplicate prefills everything from the source work item.
 */
export type CreateWorkItemDraft = {
  projectId?: string;
  workItemType?: string;
  title?: string;
  description?: string;
  assignedTo?: string;
  areaPath?: string;
  iterationPath?: string;
  /** Kept as text so a preview's string priority can seed the form directly. */
  priority?: string;
  /** ';'-joined display form, matching System.Tags. */
  tags?: string;
};

const inputClass =
  "h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "text-xs font-medium text-muted-foreground";

/**
 * Modal form that creates a work item via `create_work_item`. Fully keyboard
 * operable: opens focused on the title, Escape cancels, Ctrl+Enter submits,
 * and focus returns to the element that opened it on close.
 */
export function CreateWorkItemDialog({
  initialDraft,
  onClose,
  onCreated,
}: {
  initialDraft?: CreateWorkItemDraft | null;
  onClose: () => void;
  onCreated?: (created: WorkItemSummary) => void;
}) {
  const organizationId = useActiveOrganizationId();
  const queryClient = useQueryClient();

  const [projectId, setProjectId] = useState(initialDraft?.projectId ?? "");
  const [workItemType, setWorkItemType] = useState(initialDraft?.workItemType ?? "");
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [description, setDescription] = useState(initialDraft?.description ?? "");
  const [assignedTo, setAssignedTo] = useState(initialDraft?.assignedTo ?? "");
  const [areaPath, setAreaPath] = useState(initialDraft?.areaPath ?? "");
  const [iterationPath, setIterationPath] = useState(initialDraft?.iterationPath ?? "");
  const [priority, setPriority] = useState(initialDraft?.priority ?? "");
  const [tags, setTags] = useState(initialDraft?.tags ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  // Focus returns to whatever opened the dialog (button, preview pane, grid).
  const restoreFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    window.setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  function close() {
    const target = restoreFocusRef.current;
    onClose();
    window.setTimeout(() => target?.focus(), 0);
  }

  const projectsQuery = useQuery({
    queryKey: workItemQueryKeys.searchProjects(organizationId),
    queryFn: () => listWorkItemProjects({ organizationId }),
    staleTime: 5 * 60_000,
  });
  const projects = projectsQuery.data ?? [];
  const effectiveProjectId =
    projectId || (projects.length > 0 ? projects[0]!.projectId : "");

  const typesQuery = useQuery({
    queryKey: ["workItemTypes", organizationId, effectiveProjectId] as const,
    queryFn: () =>
      listWorkItemTypes({ organizationId, projectId: effectiveProjectId }),
    enabled: !!effectiveProjectId,
    staleTime: 5 * 60_000,
  });
  const types = typesQuery.data ?? [];
  // A template/duplicate may carry a type missing from the fetched list (e.g.
  // another project's custom type); keep it selectable instead of dropping it.
  const typeOptions =
    workItemType && !types.includes(workItemType) ? [workItemType, ...types] : types;
  const effectiveType = workItemType || (types.length > 0 ? types[0]! : "");

  const nodesQuery = useQuery({
    queryKey: ["wiCreateClassificationNodes", organizationId, effectiveProjectId] as const,
    queryFn: () =>
      listClassificationNodes({ organizationId, projectId: effectiveProjectId }),
    enabled: !!effectiveProjectId,
    staleTime: 5 * 60_000,
  });
  const areas = nodesQuery.data?.areas ?? [];
  const iterations = nodesQuery.data?.iterations ?? [];

  const mutation = useMutation({
    mutationFn: createWorkItem,
    onSuccess: (created) => {
      invalidateWorkItemMutationCaches(queryClient);
      onCreated?.(created);
      close();
    },
  });

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (mutation.isPending) return;
    if (!effectiveProjectId) {
      setFormError("Project is required.");
      return;
    }
    if (!effectiveType) {
      setFormError("Work item type is required.");
      return;
    }
    if (!title.trim()) {
      setFormError("Title is required.");
      return;
    }
    setFormError(null);
    const parsedTags = tags
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    mutation.mutate({
      organizationId,
      projectId: effectiveProjectId,
      workItemType: effectiveType,
      title: title.trim(),
      description: description.trim() || undefined,
      assignedTo: assignedTo.trim() || undefined,
      areaPath: areaPath || undefined,
      iterationPath: iterationPath || undefined,
      priority: priority ? Number(priority) : undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
    });
  }

  // Contain keys so the grid underneath does not also react to typing/arrows.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={close}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wi-create-dialog-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="wi-create-dialog-title" className="text-sm font-semibold">
            New Work Item
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={close}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          ref={formRef}
          className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4"
          onSubmit={submit}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className={labelClass}>Project</span>
              <select
                value={effectiveProjectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  // Type/area/iteration are project-scoped; reset picks so the
                  // new project's defaults apply.
                  setWorkItemType("");
                  setAreaPath("");
                  setIterationPath("");
                }}
                disabled={projectsQuery.isLoading}
                className={inputClass}
              >
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className={labelClass}>Type</span>
              <select
                value={effectiveType}
                onChange={(event) => setWorkItemType(event.target.value)}
                disabled={typesQuery.isLoading}
                className={inputClass}
              >
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className={labelClass}>Title</span>
            <input
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Summarize the work"
              className={inputClass}
            />
          </label>

          <label className="grid gap-1.5">
            <span className={labelClass}>
              Description
              <span className="ml-1 font-normal text-muted-foreground/70">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
            <label className="grid gap-1.5">
              <span className={labelClass}>
                Assigned to
                <span className="ml-1 font-normal text-muted-foreground/70">
                  (name or email)
                </span>
              </span>
              <input
                value={assignedTo}
                onChange={(event) => setAssignedTo(event.target.value)}
                placeholder="Unassigned"
                className={inputClass}
              />
            </label>
            <label className="grid gap-1.5">
              <span className={labelClass}>Priority</span>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className={inputClass}
              >
                <option value="">Default</option>
                {["1", "2", "3", "4"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className={labelClass}>Area</span>
              <select
                value={areaPath}
                onChange={(event) => setAreaPath(event.target.value)}
                disabled={nodesQuery.isLoading}
                className={inputClass}
              >
                <option value="">Project default</option>
                {areas.map((node) => (
                  <option key={node.path} value={node.path}>
                    {`${" ".repeat(node.depth * 2)}${node.name}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className={labelClass}>Iteration</span>
              <select
                value={iterationPath}
                onChange={(event) => setIterationPath(event.target.value)}
                disabled={nodesQuery.isLoading}
                className={inputClass}
              >
                <option value="">Project default</option>
                {iterations.map((node) => (
                  <option key={node.path} value={node.path}>
                    {`${" ".repeat(node.depth * 2)}${node.name}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className={labelClass}>
              Tags
              <span className="ml-1 font-normal text-muted-foreground/70">
                (semicolon separated)
              </span>
            </span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="regression; ui"
              className={inputClass}
            />
          </label>

          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}
          {mutation.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {commandErrorMessage(mutation.error)}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <span className="mr-auto text-[11px] text-muted-foreground">
              Ctrl+Enter to create
            </span>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
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
    </div>
  );
}
