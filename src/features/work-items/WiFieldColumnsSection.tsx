import { useMemo, useRef, useState } from "react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { useExtraColumnLabel, useWorkItemFields } from "./useWorkItemFields";
import { filterCustomFieldOptions } from "./workItemPreviewHelpers";
import { normalizeViewExtraColumns } from "./workItemViewsStorage";
import { isImeComposing } from "@/lib/utils";

/**
 * "Field columns" section of the work-item Columns menu: lists the Azure
 * DevOps fields shown as extra columns (uncheck to remove) and a searchable
 * picker to add more. Every control carries `data-colvis-item` so it joins the
 * menu's Up/Down cycle; Enter in the search box adds the first match.
 */
export function WiFieldColumnsSection({
  organizationId,
  extraColumns,
  onExtraColumnsChange,
}: {
  organizationId: string;
  extraColumns: string[];
  onExtraColumnsChange: (columns: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const fieldsQuery = useWorkItemFields(organizationId);
  const fieldName = useExtraColumnLabel(organizationId);
  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);
  const matches = useMemo(
    () =>
      filterCustomFieldOptions(
        fields,
        extraColumns.map((referenceName) => ({ referenceName, label: referenceName })),
        search,
        false,
      ),
    [fields, extraColumns, search],
  );

  function add(referenceName: string) {
    onExtraColumnsChange(normalizeViewExtraColumns([...extraColumns, referenceName]));
    setSearch("");
    // The clicked option unmounts; keep focus inside the menu.
    searchRef.current?.focus();
  }

  function remove(referenceName: string) {
    onExtraColumnsChange(extraColumns.filter((column) => column !== referenceName));
    searchRef.current?.focus();
  }

  const itemClass =
    "flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="border-t border-border py-1">
      <div className="px-2 py-1 text-xs font-semibold text-foreground">Field columns</div>
      {extraColumns.map((referenceName) => (
        <label key={referenceName} className={`${itemClass} cursor-pointer select-none`} title={referenceName}>
          <span className="min-w-0 truncate">{fieldName(referenceName)}</span>
          <input
            type="checkbox"
            data-colvis-item="true"
            checked
            aria-label={`Remove column ${referenceName}`}
            onChange={() => remove(referenceName)}
            className="h-3 w-3"
          />
        </label>
      ))}
      <div className="px-1 pt-1">
        <input
          ref={searchRef}
          type="search"
          data-colvis-item="true"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              add(matches[0].referenceName);
            }
          }}
          placeholder="Add field… (search)"
          aria-label="Search fields to add as columns"
          className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {fieldsQuery.isLoading ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">Loading fields…</div>
      ) : fieldsQuery.isError ? (
        <div className="px-2 py-1 text-xs text-destructive">
          {commandErrorMessage(fieldsQuery.error)}
        </div>
      ) : matches.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {search.trim() ? "No matching fields" : "Type to search all fields"}
        </div>
      ) : (
        <div role="group" aria-label="Matching fields">
          {matches.map((field) => (
            <button
              key={field.referenceName}
              type="button"
              data-colvis-item="true"
              onClick={() => add(field.referenceName)}
              className={itemClass}
              title={field.referenceName}
            >
              <span className="min-w-0 truncate">{field.name}</span>
              <span className="shrink-0 text-3xs text-muted-foreground">{field.fieldType}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
