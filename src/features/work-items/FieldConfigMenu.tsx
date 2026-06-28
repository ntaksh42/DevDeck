import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, SlidersHorizontal, X } from "lucide-react";
import type { WorkItemFieldOption } from "@/lib/azdoCommands";
import { commandErrorMessage, listWorkItemFields } from "@/lib/azdoCommands";
import {
  DEFAULT_PREVIEW_FIELD_KEYS,
  isValidFieldReferenceName,
  storeCustomPreviewFields,
  type CustomPreviewField,
  type PreviewFieldKey,
} from "./previewFieldsStorage";
import { workItemQueryKeys } from "./queryKeys";
import { useCloseOnOutsidePointer } from "./PreviewEditors";
import {
  filterCustomFieldOptions,
  PREVIEW_FIELD_DEFINITIONS,
} from "./workItemPreviewHelpers";

export function FieldConfigMenu({
  organizationId,
  projectId,
  selectedFieldKeys,
  onSelectedFieldKeysChange,
  customPreviewFields,
  onCustomPreviewFieldsChange,
}: {
  organizationId: string;
  projectId: string;
  selectedFieldKeys: PreviewFieldKey[];
  onSelectedFieldKeysChange: (keys: PreviewFieldKey[]) => void;
  customPreviewFields: CustomPreviewField[];
  onCustomPreviewFieldsChange: (fields: CustomPreviewField[]) => void;
}) {
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [customFieldLabel, setCustomFieldLabel] = useState("");
  const [customFieldReferenceName, setCustomFieldReferenceName] = useState("");
  const [customFieldSearch, setCustomFieldSearch] = useState("");
  const [customFieldError, setCustomFieldError] = useState<string | null>(null);
  const fieldMenuRef = useCloseOnOutsidePointer<HTMLDivElement>(
    fieldMenuOpen,
    () => setFieldMenuOpen(false),
  );
  const fieldMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const fieldMenuPopoverRef = useRef<HTMLDivElement>(null);
  const fieldMenuWasOpenRef = useRef(false);
  // Open onto the first checkbox; on close hand focus back to the gear trigger
  // so keyboard users aren't dropped onto <body> (mirrors the field pickers).
  useEffect(() => {
    if (fieldMenuOpen && !fieldMenuWasOpenRef.current) {
      fieldMenuPopoverRef.current
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.focus();
    } else if (!fieldMenuOpen && fieldMenuWasOpenRef.current) {
      fieldMenuTriggerRef.current?.focus();
    }
    fieldMenuWasOpenRef.current = fieldMenuOpen;
  }, [fieldMenuOpen]);
  const fieldOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.fields(organizationId, projectId),
    queryFn: () =>
      listWorkItemFields({
        organizationId,
        projectId,
      }),
    enabled: fieldMenuOpen,
    staleTime: 10 * 60_000,
  });
  const customFieldOptions = useMemo(
    () =>
      filterCustomFieldOptions(
        fieldOptionsQuery.data ?? [],
        customPreviewFields,
        customFieldSearch,
      ),
    [customFieldSearch, customPreviewFields, fieldOptionsQuery.data],
  );

  function toggleField(key: PreviewFieldKey) {
    onSelectedFieldKeysChange(
      selectedFieldKeys.includes(key)
        ? selectedFieldKeys.filter((value) => value !== key)
        : [...selectedFieldKeys, key],
    );
  }

  function addCustomField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const referenceName = customFieldReferenceName.trim();
    const label = customFieldLabel.trim() || referenceName;
    if (!isValidFieldReferenceName(referenceName)) {
      setCustomFieldError("Use a field reference name like Custom.ReleaseTrain.");
      return;
    }
    if (customPreviewFields.some((field) => field.referenceName.toLowerCase() === referenceName.toLowerCase())) {
      setCustomFieldError("That field is already shown.");
      return;
    }
    const next = [...customPreviewFields, { referenceName, label }];
    storeCustomPreviewFields(next);
    onCustomPreviewFieldsChange(next);
    setCustomFieldLabel("");
    setCustomFieldReferenceName("");
    setCustomFieldError(null);
  }

  function addCustomFieldOption(option: WorkItemFieldOption) {
    const next = [
      ...customPreviewFields,
      { referenceName: option.referenceName, label: option.name || option.referenceName },
    ];
    storeCustomPreviewFields(next);
    onCustomPreviewFieldsChange(next);
    setCustomFieldSearch("");
    setCustomFieldError(null);
  }

  function removeCustomField(referenceName: string) {
    const next = customPreviewFields.filter((field) => field.referenceName !== referenceName);
    storeCustomPreviewFields(next);
    onCustomPreviewFieldsChange(next);
  }

  return (
    <div
      ref={fieldMenuRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && fieldMenuOpen) {
          // Close the menu instead of letting Escape bubble to the
          // panel (which would discard staged edits / leave the panel).
          event.preventDefault();
          event.stopPropagation();
          setFieldMenuOpen(false);
        }
      }}
    >
      <button
        ref={fieldMenuTriggerRef}
        type="button"
        aria-expanded={fieldMenuOpen}
        aria-label="Configure preview fields"
        title="Configure preview fields"
        onClick={() => setFieldMenuOpen((open) => !open)}
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
      </button>
      {fieldMenuOpen ? (
        <div
          ref={fieldMenuPopoverRef}
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            Show attributes
          </div>
          <div className="max-h-64 overflow-auto">
            {PREVIEW_FIELD_DEFINITIONS.map((field) => (
              <label
                key={field.key}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selectedFieldKeys.includes(field.key)}
                  onChange={() => toggleField(field.key)}
                  className="h-3.5 w-3.5"
                />
                <span className="min-w-0 flex-1 truncate">{field.label}</span>
                {field.editable ? (
                  <span className="rounded border border-border bg-background px-1 text-[10px] text-muted-foreground">
                    editable
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          <div className="mt-1 border-t border-border px-2 py-1.5">
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
              Custom attributes
            </div>
            <input
              value={customFieldSearch}
              onChange={(event) => setCustomFieldSearch(event.target.value)}
              placeholder="Search fields from Azure DevOps"
              className="mb-1 h-7 w-full rounded border border-input bg-background px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mb-1.5 max-h-28 overflow-auto rounded border border-border bg-muted">
              {fieldOptionsQuery.isFetching ? (
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Loading fields...
                </div>
              ) : fieldOptionsQuery.isError ? (
                <div className="px-2 py-1.5 text-[11px] text-destructive">
                  {commandErrorMessage(fieldOptionsQuery.error)}
                </div>
              ) : customFieldOptions.length > 0 ? (
                customFieldOptions.map((field) => (
                  <button
                    key={field.referenceName}
                    type="button"
                    onClick={() => addCustomFieldOption(field)}
                    className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{field.name}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {field.referenceName}
                      </span>
                    </span>
                    <span className="shrink-0 rounded border border-border bg-card px-1 text-[10px] text-muted-foreground">
                      {field.fieldType}
                    </span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  {fieldOptionsQuery.isSuccess ? "No matching fields" : "Open to load fields"}
                </div>
              )}
            </div>
            {customPreviewFields.length > 0 ? (
              <div className="mb-1.5 grid gap-1">
                {customPreviewFields.map((field) => (
                  <div
                    key={field.referenceName}
                    className="flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px]" title={field.referenceName}>
                      {field.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${field.label}`}
                      title="Remove"
                      onClick={() => removeCustomField(field.referenceName)}
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <form className="grid gap-1" onSubmit={addCustomField}>
              <input
                value={customFieldReferenceName}
                onChange={(event) => {
                  setCustomFieldReferenceName(event.target.value);
                  setCustomFieldError(null);
                }}
                placeholder="Custom.ReleaseTrain"
                className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px] outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex items-center gap-1">
                <input
                  value={customFieldLabel}
                  onChange={(event) => setCustomFieldLabel(event.target.value)}
                  placeholder="Label"
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[11px] outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  title="Add custom field"
                  aria-label="Add custom field"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border hover:bg-secondary"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              {customFieldError ? (
                <p className="text-[10px] leading-3 text-destructive">{customFieldError}</p>
              ) : null}
            </form>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
            <button
              type="button"
              onClick={() => onSelectedFieldKeysChange(DEFAULT_PREVIEW_FIELD_KEYS)}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setFieldMenuOpen(false)}
              className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
