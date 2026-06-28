import { type FormEvent, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { type Organization, type WorkItemProjectOption, type WorkItemFieldOption } from '@/lib/azdoCommands';
import {
  MAX_VIEW_REFRESH_INTERVAL_SEC,
  MIN_VIEW_REFRESH_INTERVAL_SEC,
  normalizeViewExtraColumns,
} from './workItemViewsStorage';
import type { WiqlCompletion } from './workItemViewsHelpers';

export type ViewEditorDialogProps = {
  editingViewId: string | null;
  organizations: Organization[];
  organizationId: string;
  onOrganizationChange: (id: string) => void;
  draftUrl: string;
  onUrlChange: (url: string) => void;
  urlStatus: { text: string; severity: "success" | "error" | "info" } | null;
  draftName: string;
  onNameChange: (v: string) => void;
  draftProjectId: string;
  onProjectChange: (v: string) => void;
  projectOptions: WorkItemProjectOption[];
  projectsLoading: boolean;
  draftLimit: string;
  onLimitChange: (v: string) => void;
  draftRefreshInterval: string;
  onRefreshIntervalChange: (v: string) => void;
  draftAlertThreshold: string;
  onAlertThresholdChange: (v: string) => void;
  draftWiql: string;
  updateDraftWiql: (v: string, cursor: number) => void;
  draftWiqlTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  wiqlCursor: number;
  setWiqlCursor: (cursor: number) => void;
  wiqlCompletionsOpen: boolean;
  setWiqlCompletionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  wiqlCompletions: WiqlCompletion[];
  onApplyCompletion: (completion: WiqlCompletion) => void;
  onInsertWiqlText: (text: string) => void;
  wiqlValidation: { errors: string[]; warnings: string[] };
  draftExtraColumns: string[];
  onExtraColumnsChange: (cols: string[]) => void;
  fields: WorkItemFieldOption[];
  fieldsLoading: boolean;
  formError: string | null;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

export function ViewEditorDialog({
  editingViewId,
  organizations,
  organizationId,
  onOrganizationChange,
  draftUrl,
  onUrlChange,
  urlStatus,
  draftName,
  onNameChange,
  draftProjectId,
  onProjectChange,
  projectOptions,
  projectsLoading,
  draftLimit,
  onLimitChange,
  draftRefreshInterval,
  onRefreshIntervalChange,
  draftAlertThreshold,
  onAlertThresholdChange,
  draftWiql,
  updateDraftWiql,
  draftWiqlTextareaRef,
  setWiqlCursor,
  wiqlCompletionsOpen,
  setWiqlCompletionsOpen,
  wiqlCompletions,
  onApplyCompletion,
  onInsertWiqlText,
  wiqlValidation,
  draftExtraColumns,
  onExtraColumnsChange,
  fields,
  fieldsLoading,
  formError,
  onSave,
  onClose,
}: ViewEditorDialogProps) {
  const viewFormRef = useRef<HTMLFormElement | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-dialog-title"
        className="relative w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-popover shadow-xl"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="view-dialog-title" className="text-sm font-semibold">
            {editingViewId ? "Edit View" : "Add View"}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          ref={viewFormRef}
          className="grid gap-3 p-4"
          onSubmit={onSave}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              viewFormRef.current?.requestSubmit();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
            }
          }}
        >
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="view-url-input">
              Azure DevOps URL
              <span className="ml-1 font-normal text-muted-foreground/70">
                (paste to auto-fill Org / Project / WIQL)
              </span>
            </label>
            <input
              id="view-url-input"
              value={draftUrl}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://dev.azure.com/{org}/{project}/_queries/query/{id}"
              autoFocus
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {urlStatus ? (
              <p
                className={`text-xs ${
                  urlStatus.severity === "success"
                    ? "text-green-700 dark:text-green-400"
                    : urlStatus.severity === "error"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {urlStatus.text}
              </p>
            ) : null}
          </div>

          {organizations.length > 1 ? (
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Organization</span>
              <select
                value={organizationId}
                onChange={(event) => onOrganizationChange(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <input
              value={draftName}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Active bugs"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Project</span>
              <select
                value={draftProjectId}
                disabled={projectsLoading || projectOptions.length === 0}
                onChange={(event) => onProjectChange(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">Select project</option>
                {projectOptions.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Limit</span>
              <input
                type="number"
                min={1}
                max={500}
                value={draftLimit}
                onChange={(event) => onLimitChange(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Auto refresh (sec)
                <span className="ml-1 font-normal text-muted-foreground/70">(empty = off)</span>
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
                <span className="ml-1 font-normal text-muted-foreground/70">(empty = off)</span>
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
            <div className="flex items-center justify-between gap-2">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="view-wiql-input"
              >
                WIQL
              </label>
              <span className="flex flex-wrap justify-end gap-1">
                {["@Me", "@Today", "@CurrentIteration", "@Follows"].map((macro) => (
                  <button
                    key={macro}
                    type="button"
                    onClick={() => onInsertWiqlText(macro)}
                    className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] hover:bg-secondary"
                  >
                    {macro}
                  </button>
                ))}
              </span>
            </div>
            <textarea
              ref={draftWiqlTextareaRef}
              id="view-wiql-input"
              value={draftWiql}
              onChange={(event) => {
                updateDraftWiql(event.target.value, event.target.selectionStart);
                setWiqlCompletionsOpen(true);
              }}
              onClick={(event) => setWiqlCursor(event.currentTarget.selectionStart)}
              onKeyUp={(event) => setWiqlCursor(event.currentTarget.selectionStart)}
              onFocus={(event) => {
                setWiqlCursor(event.currentTarget.selectionStart);
                setWiqlCompletionsOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.ctrlKey && event.key === " ") {
                  event.preventDefault();
                  setWiqlCompletionsOpen((open) => !open);
                }
                if (event.key === "Escape" && wiqlCompletionsOpen) {
                  event.stopPropagation();
                  setWiqlCompletionsOpen(false);
                }
              }}
              rows={7}
              spellCheck={false}
              className="min-h-[120px] resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring"
            />
            {wiqlCompletionsOpen && wiqlCompletions.length > 0 ? (
              <div className="flex max-h-24 flex-wrap gap-1 overflow-auto rounded-md border border-border bg-muted p-1.5">
                {wiqlCompletions.map((completion) => (
                  <button
                    key={`${completion.label}:${completion.value}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onApplyCompletion(completion)}
                    className="rounded border border-border bg-card px-1.5 py-0.5 text-left text-[11px] hover:bg-secondary"
                    title={completion.detail}
                  >
                    <span className="font-mono">{completion.label}</span>
                    <span className="ml-1 text-muted-foreground">{completion.detail}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {wiqlValidation.errors.length > 0 || wiqlValidation.warnings.length > 0 ? (
              <div className="space-y-0.5 text-xs">
                {wiqlValidation.errors.map((error) => (
                  <p key={error} className="text-destructive">{error}</p>
                ))}
                {wiqlValidation.warnings.map((warning) => (
                  <p key={warning} className="text-amber-700 dark:text-amber-400">{warning}</p>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Extra columns
              <span className="ml-1 font-normal text-muted-foreground/70">
                (shown after the standard columns)
              </span>
            </span>
            {draftExtraColumns.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {draftExtraColumns.map((referenceName) => (
                  <span
                    key={referenceName}
                    className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px]"
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

          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {editingViewId ? "Update" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
