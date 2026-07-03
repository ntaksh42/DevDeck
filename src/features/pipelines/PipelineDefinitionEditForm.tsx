import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Save, Trash2, X } from "lucide-react";
import {
  commandErrorMessage,
  updatePipelineDefinition,
  type PipelineDefinitionDetail,
} from "@/lib/azdoCommands";

type EditableVariable = {
  id: number;
  name: string;
  value: string;
  allowOverride: boolean;
};

function parseFilterLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const inputClass =
  "h-7 min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring";
const textareaClass =
  "resize-y rounded-md border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Inline editor for a pipeline definition's non-secret variables and CI
 * trigger, opened from PipelineDefinitionPanel's Edit button. Fully keyboard
 * operable: opens focused on the first field, Escape cancels, and focus
 * returns to the Edit button on close (handled by the parent panel).
 */
export function PipelineDefinitionEditForm({
  organizationId,
  projectId,
  definitionId,
  detail,
  onCancel,
  onSaved,
}: {
  organizationId: string;
  projectId: string;
  definitionId: number;
  detail: PipelineDefinitionDetail;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(0);
  const nameInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const secretVariables = detail.variables.filter((variable) => variable.isSecret);

  const [variables, setVariables] = useState<EditableVariable[]>(() =>
    detail.variables
      .filter((variable) => !variable.isSecret)
      .map((variable) => {
        nextIdRef.current += 1;
        return {
          id: nextIdRef.current,
          name: variable.name,
          value: variable.value ?? "",
          allowOverride: variable.allowOverride,
        };
      }),
  );
  const [focusRowId, setFocusRowId] = useState<number | null>(null);

  const existingCiTrigger = detail.triggers.find(
    (trigger) => trigger.triggerType === "continuousIntegration",
  );
  const [ciTouched, setCiTouched] = useState(false);
  const [ciEnabled, setCiEnabled] = useState(!!existingCiTrigger);
  const [branchFiltersText, setBranchFiltersText] = useState(
    (existingCiTrigger?.branchFilters ?? []).join("\n"),
  );
  const [pathFiltersText, setPathFiltersText] = useState(
    (existingCiTrigger?.pathFilters ?? []).join("\n"),
  );
  const [formError, setFormError] = useState<string | null>(null);

  // Focus the first editable control when the form mounts.
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), button:not([disabled])",
    );
    const timer = window.setTimeout(() => el?.focus(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus a newly added row's name input once it renders.
  useEffect(() => {
    if (focusRowId == null) return;
    nameInputRefs.current.get(focusRowId)?.focus();
    setFocusRowId(null);
  }, [focusRowId, variables]);

  const mutation = useMutation({
    mutationFn: () =>
      updatePipelineDefinition({
        organizationId,
        projectId,
        definitionId,
        variables: variables
          .filter((variable) => variable.name.trim().length > 0)
          .map((variable) => ({
            name: variable.name.trim(),
            value: variable.value,
            allowOverride: variable.allowOverride,
          })),
        ciTrigger: ciTouched
          ? {
              enabled: ciEnabled,
              branchFilters: parseFilterLines(branchFiltersText),
              pathFilters: parseFilterLines(pathFiltersText),
            }
          : null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        ["pipelineDefinition", organizationId, projectId, definitionId],
        updated,
      );
      onSaved();
    },
  });

  function addVariable() {
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setVariables((prev) => [...prev, { id, name: "", value: "", allowOverride: false }]);
    setFocusRowId(id);
  }

  function removeVariable(id: number) {
    nameInputRefs.current.delete(id);
    setVariables((prev) => prev.filter((variable) => variable.id !== id));
  }

  function updateVariable(id: number, patch: Partial<Omit<EditableVariable, "id">>) {
    setVariables((prev) =>
      prev.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    if (ciTouched && ciEnabled && parseFilterLines(branchFiltersText).length === 0) {
      setFormError("A CI trigger must have at least one branch filter.");
      return;
    }
    setFormError(null);
    mutation.mutate();
  }

  // Contain keys so the underlying pipeline list does not also react.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  const displayError = formError ?? (mutation.isError ? commandErrorMessage(mutation.error) : null);

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Variables
            </h3>
            <button
              type="button"
              onClick={addVariable}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              Add variable
            </button>
          </div>

          {secretVariables.length > 0 ? (
            <div className="flex flex-col gap-1">
              {secretVariables.map((variable) => (
                <div
                  key={variable.name}
                  className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {variable.name}
                  </span>
                  <span>(secret)</span>
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                    Secret
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            {variables.map((variable, index) => (
              <div key={variable.id} className="flex items-center gap-1.5">
                <input
                  ref={(el) => {
                    if (el) nameInputRefs.current.set(variable.id, el);
                    else nameInputRefs.current.delete(variable.id);
                  }}
                  value={variable.name}
                  onChange={(event) => updateVariable(variable.id, { name: event.target.value })}
                  placeholder="Name"
                  aria-label={`Variable ${index + 1} name`}
                  className={`${inputClass} flex-1`}
                />
                <input
                  value={variable.value}
                  onChange={(event) => updateVariable(variable.id, { value: event.target.value })}
                  placeholder="Value"
                  aria-label={`Variable ${index + 1} value`}
                  className={`${inputClass} flex-1 font-mono`}
                />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={variable.allowOverride}
                    onChange={(event) =>
                      updateVariable(variable.id, { allowOverride: event.target.checked })
                    }
                    aria-label={`Variable ${index + 1} allow override`}
                  />
                  Overridable
                </label>
                <button
                  type="button"
                  onClick={() => removeVariable(variable.id)}
                  aria-label={`Remove variable ${variable.name || index + 1}`}
                  title="Remove variable"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            CI trigger
          </h3>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={ciEnabled}
              onChange={(event) => {
                setCiTouched(true);
                setCiEnabled(event.target.checked);
              }}
            />
            Enable continuous integration trigger
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] text-muted-foreground">
              Branch filters (one per line, e.g. +refs/heads/main)
            </span>
            <textarea
              value={branchFiltersText}
              onChange={(event) => {
                setCiTouched(true);
                setBranchFiltersText(event.target.value);
              }}
              disabled={!ciEnabled}
              rows={3}
              aria-label="CI trigger branch filters"
              className={textareaClass}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] text-muted-foreground">
              Path filters (one per line, optional)
            </span>
            <textarea
              value={pathFiltersText}
              onChange={(event) => {
                setCiTouched(true);
                setPathFiltersText(event.target.value);
              }}
              disabled={!ciEnabled}
              rows={2}
              aria-label="CI trigger path filters"
              className={textareaClass}
            />
          </label>
        </section>

        {displayError ? (
          <p role="alert" className="text-xs text-destructive">
            {displayError}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={mutation.isPending}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
