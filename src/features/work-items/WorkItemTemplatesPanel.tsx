import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { FileText, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import {
  MAX_TEMPLATE_PRIORITY,
  MIN_TEMPLATE_PRIORITY,
  loadWorkItemTemplates,
  newWorkItemTemplateId,
  saveWorkItemTemplates,
  templateFields,
  type WorkItemTemplate,
  type WorkItemTemplateFields,
} from "./workItemTemplatesStorage";

type TemplateDraft = {
  name: string;
  workItemType: string;
  title: string;
  priority: string;
  areaPath: string;
  iteration: string;
  tags: string;
};

function emptyDraft(): TemplateDraft {
  return {
    name: "",
    workItemType: "",
    title: "",
    priority: "",
    areaPath: "",
    iteration: "",
    tags: "",
  };
}

function draftFromTemplate(template: WorkItemTemplate): TemplateDraft {
  return {
    name: template.name,
    workItemType: template.workItemType,
    title: template.title ?? "",
    priority: template.priority !== undefined ? String(template.priority) : "",
    areaPath: template.areaPath ?? "",
    iteration: template.iteration ?? "",
    tags: (template.tags ?? []).join(", "),
  };
}

function templateSummary(template: WorkItemTemplate): string {
  const parts = [template.workItemType];
  if (template.priority !== undefined) parts.push(`P${template.priority}`);
  if (template.areaPath) parts.push(template.areaPath);
  if (template.iteration) parts.push(template.iteration);
  if (template.tags && template.tags.length > 0) parts.push(template.tags.join(", "));
  return parts.join(" · ");
}

type WorkItemTemplatesPanelProps = {
  /**
   * Called when a template is applied. A future create form (#39) consumes the
   * resolved field set; until then the panel surfaces a confirmation so the
   * flow is usable on its own.
   */
  onApplyTemplate?: (fields: WorkItemTemplateFields) => void;
};

export function WorkItemTemplatesPanel({ onApplyTemplate }: WorkItemTemplatesPanelProps) {
  const [templates, setTemplates] = useState<WorkItemTemplate[]>(() => loadWorkItemTemplates());
  const [managerOpen, setManagerOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(() => emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const manageButtonRef = useRef<HTMLButtonElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    saveWorkItemTemplates(templates);
  }, [templates]);

  useEffect(() => {
    if (managerOpen) {
      window.setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [managerOpen, editingId]);

  function returnFocus() {
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    window.setTimeout(() => target?.focus(), 0);
  }

  function applyTemplate(template: WorkItemTemplate) {
    onApplyTemplate?.(templateFields(template));
    setStatus(`Applied template "${template.name}".`);
    setCreateMenuOpen(false);
    returnFocus();
  }

  function openManagerForNew() {
    restoreFocusRef.current = manageButtonRef.current;
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError(null);
    setManagerOpen(true);
    setCreateMenuOpen(false);
  }

  function openManagerForEdit(template: WorkItemTemplate) {
    restoreFocusRef.current = manageButtonRef.current;
    setEditingId(template.id);
    setDraft(draftFromTemplate(template));
    setFormError(null);
    setManagerOpen(true);
  }

  function closeManager() {
    setManagerOpen(false);
    setFormError(null);
    returnFocus();
  }

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    const workItemType = draft.workItemType.trim();
    if (!name) {
      setFormError("Template name is required.");
      return;
    }
    if (!workItemType) {
      setFormError("Work item type is required.");
      return;
    }
    const priorityInput = draft.priority.trim();
    let priority: number | undefined;
    if (priorityInput) {
      const parsed = Number(priorityInput);
      if (!Number.isFinite(parsed) || parsed < MIN_TEMPLATE_PRIORITY || parsed > MAX_TEMPLATE_PRIORITY) {
        setFormError(`Priority must be between ${MIN_TEMPLATE_PRIORITY} and ${MAX_TEMPLATE_PRIORITY}.`);
        return;
      }
      priority = Math.round(parsed);
    }
    const tags = draft.tags
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);

    const next: WorkItemTemplate = {
      id: editingId ?? newWorkItemTemplateId(),
      name,
      isDefault: editingId ? templates.find((t) => t.id === editingId)?.isDefault : undefined,
      workItemType,
      title: draft.title.trim() || undefined,
      priority,
      areaPath: draft.areaPath.trim() || undefined,
      iteration: draft.iteration.trim() || undefined,
      tags,
    };

    setTemplates((current) =>
      editingId && current.some((t) => t.id === editingId)
        ? current.map((t) => (t.id === editingId ? next : t))
        : [...current, next],
    );
    setStatus(editingId ? `Updated template "${name}".` : `Saved template "${name}".`);
    closeManager();
  }

  function deleteTemplate(template: WorkItemTemplate) {
    setTemplates((current) => current.filter((t) => t.id !== template.id));
    setStatus(`Deleted template "${template.name}".`);
  }

  function toggleDefault(template: WorkItemTemplate) {
    setTemplates((current) =>
      current.map((t) => ({
        ...t,
        isDefault: t.id === template.id ? !template.isDefault : false,
      })),
    );
  }

  function handleCreateMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      createMenuRef.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]") ?? [],
    );
    if (items.length === 0) return;
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      items[(activeIndex + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      items[(activeIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      items[items.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setCreateMenuOpen(false);
      createButtonRef.current?.focus();
    }
  }

  useEffect(() => {
    if (!createMenuOpen) return;
    window.setTimeout(() => {
      createMenuRef.current
        ?.querySelector<HTMLButtonElement>("[data-menu-item]")
        ?.focus();
    }, 0);
  }, [createMenuOpen]);

  const hasTemplates = templates.length > 0;

  return (
    <div className="flex items-center gap-1.5">
      {/* "Create from template" — hidden entirely when no templates exist. */}
      {hasTemplates ? (
        <div className="relative">
          <button
            ref={createButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={createMenuOpen}
            onClick={() => {
              restoreFocusRef.current = createButtonRef.current;
              setCreateMenuOpen((open) => !open);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Create from template
          </button>
          {createMenuOpen ? (
            <>
              <div
                className="fixed inset-0 z-40"
                aria-hidden="true"
                onClick={() => setCreateMenuOpen(false)}
              />
              <div
                ref={createMenuRef}
                role="menu"
                aria-label="Create from template"
                onKeyDown={handleCreateMenuKeyDown}
                className="absolute right-0 z-50 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-border bg-popover p-1 shadow-xl"
              >
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    role="menuitem"
                    data-menu-item
                    onClick={() => applyTemplate(template)}
                    className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left outline-none hover:bg-secondary focus:bg-secondary"
                  >
                    <span className="flex w-full items-center gap-1 text-sm font-medium">
                      <span className="min-w-0 truncate">{template.name}</span>
                      {template.isDefault ? (
                        <Star className="h-3 w-3 shrink-0 fill-current text-amber-500" aria-label="Default" />
                      ) : null}
                    </span>
                    <span className="w-full truncate text-[11px] text-muted-foreground">
                      {templateSummary(template)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <button
        ref={manageButtonRef}
        type="button"
        onClick={() => {
          restoreFocusRef.current = manageButtonRef.current;
          openManagerForNew();
        }}
        title="Manage work item templates"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Templates
      </button>

      {status ? (
        <span role="status" className="truncate text-[11px] text-muted-foreground">
          {status}
        </span>
      ) : null}

      {managerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeManager}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wi-template-dialog-title"
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeManager();
              }
            }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="wi-template-dialog-title" className="text-sm font-semibold">
                Work Item Templates
              </h2>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={closeManager}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {templates.length > 0 ? (
                <ul className="divide-y divide-border border-b border-border">
                  {templates.map((template) => (
                    <li key={template.id} className="flex items-center gap-2 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-sm font-medium">
                          <span className="min-w-0 truncate">{template.name}</span>
                          {template.isDefault ? (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              Default
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {templateSummary(template)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleDefault(template)}
                        aria-pressed={template.isDefault === true}
                        title={template.isDefault ? "Unset as default" : "Set as default"}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-secondary"
                      >
                        <Star
                          className={`h-3.5 w-3.5 ${template.isDefault ? "fill-current text-amber-500" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => openManagerForEdit(template)}
                        title="Edit template"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-secondary"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTemplate(template)}
                        title="Delete template"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  No templates yet. Fill the form below to save your first one.
                </p>
              )}

              <form ref={formRef} className="grid gap-3 p-4" onSubmit={saveDraft}>
                <p className="text-xs font-medium text-muted-foreground">
                  {editingId ? "Edit template" : "New template"}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Name</span>
                    <input
                      ref={nameInputRef}
                      value={draft.name}
                      onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
                      placeholder="Sprint Bug"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Work item type</span>
                    <input
                      value={draft.workItemType}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, workItemType: event.target.value }))
                      }
                      placeholder="Bug"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Title
                    <span className="ml-1 font-normal text-muted-foreground/70">(optional seed)</span>
                  </span>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-[90px_1fr]">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Priority</span>
                    <input
                      type="number"
                      min={MIN_TEMPLATE_PRIORITY}
                      max={MAX_TEMPLATE_PRIORITY}
                      value={draft.priority}
                      onChange={(event) => setDraft((d) => ({ ...d, priority: event.target.value }))}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Area path</span>
                    <input
                      value={draft.areaPath}
                      onChange={(event) => setDraft((d) => ({ ...d, areaPath: event.target.value }))}
                      placeholder="Contoso\\Web"
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Iteration</span>
                  <input
                    value={draft.iteration}
                    onChange={(event) => setDraft((d) => ({ ...d, iteration: event.target.value }))}
                    placeholder="Contoso\\Sprint 1"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Tags
                    <span className="ml-1 font-normal text-muted-foreground/70">(comma separated)</span>
                  </span>
                  <input
                    value={draft.tags}
                    onChange={(event) => setDraft((d) => ({ ...d, tags: event.target.value }))}
                    placeholder="regression, ui"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>

                {formError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {formError}
                  </p>
                ) : null}

                <div className="flex items-center justify-between gap-2 pt-1">
                  {editingId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setDraft(emptyDraft());
                        setFormError(null);
                        window.setTimeout(() => nameInputRef.current?.focus(), 0);
                      }}
                      className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
                    >
                      New template
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {editingId ? "Update template" : "Save template"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
