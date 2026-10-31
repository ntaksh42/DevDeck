import { useRef, useState } from 'react';
import { CheckCircle2, Loader2, Play, Plus, TriangleAlert, X } from 'lucide-react';
import { type WorkItemProjectOption } from '@/lib/azdoCommands';
import type { ViewEditorDraftReturn } from './useViewEditorDraft';
import { ProjectQueryPicker } from './ProjectQueryPicker';
import { ViewAdvancedSettings } from './ViewAdvancedSettings';
import { WiqlEditor } from './WiqlEditor';
import { isImeComposing } from '@/lib/utils';

type SourceTab = "url" | "query";
const SOURCE_TABS: { id: SourceTab; label: string }[] = [
  { id: "url", label: "Paste URL" },
  { id: "query", label: "From existing query" },
];
const SOURCE_TAB_FOCUS_ID: Record<SourceTab, string> = {
  url: "view-url-input",
  query: "view-project-query-filter",
};

export type ViewEditorDialogProps = {
  draft: ViewEditorDraftReturn;
  projectOptions: WorkItemProjectOption[];
  projectsLoading: boolean;
  onClose: () => void;
};

export function ViewEditorDialog({
  draft,
  projectOptions,
  projectsLoading,
  onClose,
}: ViewEditorDialogProps) {
  const {
    editingViewId,
    draftUrl,
    onUrlChange,
    urlStatus,
    draftName,
    onNameChange,
    draftProjectId,
    onProjectChange,
    draftWiql,
    updateDraftWiql,
    draftWiqlTextareaRef,
    setWiqlCursor,
    wiqlCompletionsOpen,
    setWiqlCompletionsOpen,
    wiqlCompletions,
    activeCompletionIndex,
    setActiveCompletionIndex,
    wiqlExpanded,
    setWiqlExpanded,
    testResult,
    applyWiqlCompletion: onApplyCompletion,
    insertWiqlText: onInsertWiqlText,
    wiqlValidation,
    projectQueries,
    projectQueriesLoading,
    projectQueriesError,
    onProjectQuerySelect,
    formError,
    saveView: onSave,
  } = draft;
  const onTestRun = () => void draft.runTestQuery();
  const viewFormRef = useRef<HTMLFormElement | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>("url");
  function selectSourceTab(tab: SourceTab) {
    setSourceTab(tab);
    window.setTimeout(() => document.getElementById(SOURCE_TAB_FOCUS_ID[tab])?.focus(), 0);
  }

  function onSourceTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const index = SOURCE_TABS.findIndex((tab) => tab.id === sourceTab);
    const next =
      event.key === "ArrowRight" ? index + 1
      : event.key === "ArrowLeft" ? index - 1
      : event.key === "Home" ? 0
      : event.key === "End" ? SOURCE_TABS.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    const tab = SOURCE_TABS[(next + SOURCE_TABS.length) % SOURCE_TABS.length];
    setSourceTab(tab.id);
    window.setTimeout(() => document.getElementById(`view-source-tab-${tab.id}`)?.focus(), 0);
  }
  // Focus returns to whatever opened the dialog (button, preview pane, grid),
  // mirroring CreateWorkItemDialog, so keyboard navigation is not stranded on
  // <body> after the dialog closes.
  const restoreFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  function close() {
    const target = restoreFocusRef.current;
    onClose();
    window.setTimeout(() => target?.focus(), 0);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-dialog-title"
        className={`relative w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-xl ${
          wiqlExpanded ? "max-w-4xl" : "max-w-2xl"
        }`}
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          // On the outer dialog rather than the form so Escape also works from
          // the header close button, and never reaches the grid behind it.
          if (isImeComposing(event)) return;
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="view-dialog-title" className="text-sm font-semibold">
            {editingViewId ? "Edit View" : "Add View"}
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
          ref={viewFormRef}
          className="grid gap-3 p-4"
          onSubmit={onSave}
          onKeyDown={(event) => {
            if (isImeComposing(event)) return;
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              viewFormRef.current?.requestSubmit();
            }
          }}
        >
          <div className="grid gap-1.5">
            <div role="tablist" aria-label="How to set up this view" className="flex gap-1 border-b border-border">
              {SOURCE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  id={`view-source-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === tab.id}
                  aria-controls={`view-source-panel-${tab.id}`}
                  tabIndex={sourceTab === tab.id ? 0 : -1}
                  onClick={() => selectSourceTab(tab.id)}
                  onKeyDown={onSourceTabKeyDown}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${
                    sourceTab === tab.id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              id="view-source-panel-url"
              role="tabpanel"
              aria-labelledby="view-source-tab-url"
              hidden={sourceTab !== "url"}
              className={sourceTab === "url" ? "grid gap-1.5" : "hidden"}
            >
              <label className="text-xs font-medium text-muted-foreground" htmlFor="view-url-input">
                Azure DevOps URL
                <span className="ml-1 font-normal text-muted-foreground">
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
                      ? "text-success"
                      : urlStatus.severity === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {urlStatus.text}
                </p>
              ) : null}
            </div>

            <div
              id="view-source-panel-query"
              role="tabpanel"
              aria-labelledby="view-source-tab-query"
              hidden={sourceTab !== "query"}
            >
              <ProjectQueryPicker
                queries={projectQueries}
                hasProject={Boolean(draftProjectId)}
                loading={projectQueriesLoading}
                error={projectQueriesError}
                onSelect={onProjectQuerySelect}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <input
                value={draftName}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Active bugs"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

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
          </div>

          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap gap-1">
                {["@Me", "@Today", "@CurrentIteration", "@Follows"].map((macro) => (
                  <button
                    key={macro}
                    type="button"
                    onClick={() => onInsertWiqlText(macro)}
                    className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-2xs hover:bg-secondary"
                  >
                    {macro}
                  </button>
                ))}
              </span>
              <button
                type="button"
                onClick={onTestRun}
                disabled={testResult?.status === "running"}
                title="Run the query and show how many work items match"
                className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-2xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play className="h-3 w-3" aria-hidden="true" />
                Test
              </button>
            </div>
            <WiqlEditor
              value={draftWiql}
              onChange={updateDraftWiql}
              textareaRef={draftWiqlTextareaRef}
              onCursorChange={setWiqlCursor}
              completionsOpen={wiqlCompletionsOpen}
              setCompletionsOpen={setWiqlCompletionsOpen}
              completions={wiqlCompletions}
              activeCompletionIndex={activeCompletionIndex}
              setActiveCompletionIndex={setActiveCompletionIndex}
              onApplyCompletion={onApplyCompletion}
              expanded={wiqlExpanded}
              onExpandedChange={setWiqlExpanded}
            />
            {wiqlValidation.errors.length > 0 || wiqlValidation.warnings.length > 0 ? (
              <div className="space-y-0.5 text-xs">
                {wiqlValidation.errors.map((error) => (
                  <p key={error} className="text-destructive">{error}</p>
                ))}
                {wiqlValidation.warnings.map((warning) => (
                  <p key={warning} className="text-warning">{warning}</p>
                ))}
              </div>
            ) : null}
            {testResult ? (
              <div
                role="status"
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                  testResult.status === "error"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : testResult.status === "ok"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {testResult.status === "running" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Running test query…
                  </>
                ) : testResult.status === "ok" ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {testResult.count} matching work item{testResult.count === 1 ? "" : "s"}
                  </>
                ) : (
                  <>
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{testResult.message}</span>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <ViewAdvancedSettings draft={draft} />

          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {editingViewId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
