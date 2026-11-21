import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  MAX_VIEW_REFRESH_INTERVAL_SEC,
  MIN_VIEW_REFRESH_INTERVAL_SEC,
  normalizeViewExtraColumns,
} from './workItemViewsStorage';
import type { ViewEditorDraftReturn } from './useViewEditorDraft';

type ViewAdvancedSettingsProps = {
  draft: ViewEditorDraftReturn;
};

/** Rarely changed view settings, collapsed behind a one-line summary of the current values. */
export function ViewAdvancedSettings({ draft }: ViewAdvancedSettingsProps) {
  const {
    draftLimit,
    onLimitChange,
    draftRefreshInterval,
    onRefreshIntervalChange,
    draftAlertThreshold,
    onAlertThresholdChange,
    draftExtraColumns,
    onExtraColumnsChange,
    fields,
    fieldsLoading,
    formError,
  } = draft;
  const [open, setOpen] = useState(false);
  // These fields are hidden while collapsed, so an error about one of them
  // would otherwise point at a field nobody can see.
  useEffect(() => {
    if (formError && /^(Limit|Auto refresh|Alert)/.test(formError)) setOpen(true);
  }, [formError]);
  const summary = [
    `Limit ${draftLimit || 'none'}`,
    `Refresh ${draftRefreshInterval ? `${draftRefreshInterval}s` : 'off'}`,
    `Alert ${draftAlertThreshold ? `≥ ${draftAlertThreshold}` : 'off'}`,
    `Columns ${draftExtraColumns.length}`,
  ].join(' · ');

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-md border border-border bg-muted/30"
    >
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Advanced settings</span>
        <span className="ml-2">{summary}</span>
      </summary>
      <div className="grid gap-3 border-t border-border p-3">
        <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Limit
            <span className="ml-1 font-normal text-muted-foreground">(empty = none)</span>
          </span>
          <input
            type="number"
            min={1}
            placeholder="no limit"
            value={draftLimit}
            onChange={(event) => onLimitChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Auto refresh (sec)
            <span className="ml-1 font-normal text-muted-foreground">(empty = off)</span>
          </span>
          <input
            type="number"
            min={MIN_VIEW_REFRESH_INTERVAL_SEC}
            max={MAX_VIEW_REFRESH_INTERVAL_SEC}
            placeholder="off"
            value={draftRefreshInterval}
            onChange={(event) => onRefreshIntervalChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Alert when count ≥
            <span className="ml-1 font-normal text-muted-foreground">(empty = off)</span>
          </span>
          <input
            type="number"
            min={0}
            placeholder="off"
            value={draftAlertThreshold}
            onChange={(event) => onAlertThresholdChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        </div>

        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Extra columns
            <span className="ml-1 font-normal text-muted-foreground">
              (shown after the standard columns)
            </span>
          </span>
          {draftExtraColumns.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {draftExtraColumns.map((referenceName) => (
                <span
                  key={referenceName}
                  className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-2xs"
                  title={referenceName}
                >
                  {referenceName}
                  <button
                    type="button"
                    aria-label={`Remove column ${referenceName}`}
                    onClick={() => onExtraColumnsChange(draftExtraColumns.filter((c) => c !== referenceName))}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <select
            value=""
            aria-label="Add extra column"
            disabled={fieldsLoading}
            onChange={(event) => {
              const referenceName = event.target.value;
              if (!referenceName) return;
              onExtraColumnsChange(normalizeViewExtraColumns([...draftExtraColumns, referenceName]));
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          >
            <option value="">Add column…</option>
            {fields
              .filter(
                (field) =>
                  !draftExtraColumns.some(
                    (existing) => existing.toLowerCase() === field.referenceName.toLowerCase(),
                  ),
              )
              .map((field) => (
                <option key={field.referenceName} value={field.referenceName}>
                  {field.name} ({field.referenceName})
                </option>
              ))}
          </select>
        </div>
      </div>
    </details>
  );
}
