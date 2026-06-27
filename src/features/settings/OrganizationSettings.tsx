import { type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bell, Building2, Clock, Eye, EyeOff, FileText, Keyboard, Loader2, Monitor, Moon, Palette, Play, Plus, RefreshCw, Send, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import {
  addAzureCliOrganization,
  addPatOrganization,
  deleteOrganization,
  getAppSettings,
  listPipelineDefinitions,
  listPipelineProjects,
  listSyncStates,
  updateAppSettings,
  commandErrorMessage,
  triggerSync,
  DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
  REVIEW_STALE_THRESHOLD_DAY_OPTIONS,
  DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
  WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS,
  NOTIFICATION_RULE_TYPES,
  type AppSettings,
  type NotificationRule,
  type Organization,
  type SyncScope,
  type SyncState,
  type UpdateAppSettingsInput,
} from '@/lib/azdoCommands';
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterableSelect, type SelectOption } from "@/features/pipelines/FilterableSelect";
import {
  DEFAULT_QUICK_PIPELINE_BRANCH,
  addQuickPipeline,
  loadQuickPipelines,
  removeQuickPipeline,
  saveQuickPipelines,
  type QuickPipeline,
} from "@/features/pipelines/quickPipelinesStorage";
import { emitQuickPipelinesChanged } from "@/features/pipelines/quickPipelinesEvents";
import { sendTestDesktopNotification } from "@/lib/desktopNotifications";
import { SoftwareUpdateSettings } from "./SoftwareUpdateSettings";
import { RowColorRulesSettings } from "./RowColorRulesSettings";
import {
  LAYOUT_STORAGE_PREFIX,
  clearLayoutStorage,
} from "@/lib/layoutReset";
import {
  KEYBINDINGS,
  comboFromEvent,
  defaultKeybindingMap,
  findConflicts,
  keybindingLabel,
  resolveKeybindings,
  saveKeybindingOverrides,
  type KeybindingId,
  type KeybindingMap,
} from "@/lib/keybindings";
import {
  loadThemePreference,
  setThemePreference,
  THEME_CHANGED_EVENT,
  type ThemePreference,
} from "@/lib/theme";
export function OrganizationSettings({
  organizations,
}: {
  organizations: Organization[];
}) {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Organization | null>(null);
  const deleteMutation = useMutation({
    mutationFn: deleteOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });

  return (
    <div className="space-y-3">
      <SetupPanel compact />
      <ThemeSettings />
      <KeyboardShortcutSettings />
      <ShowWindowHotkeySettings />
      <DesktopNotificationSettings />
      <NotificationRulesSettings />
      <ReviewResultFolderSettings />
      <QuickPipelinesSettings organizations={organizations} />
      <ReviewStaleThresholdSettings />
      <WorkItemStaleThresholdSettings />
      <RowColorRulesSettings />
      <SyncHealthSettings organizations={organizations} />
      <DataCacheSettings />
      <SoftwareUpdateSettings />
      <ValidationModeSettings />
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-base font-semibold">Organizations</h2>
        </div>
        {deleteMutation.isError && (
          <p className="px-5 py-2 text-sm text-destructive">
            {commandErrorMessage(deleteMutation.error)}
          </p>
        )}
        <div className="divide-y divide-border">
          {organizations.map((organization) => (
            <div
              key={organization.id}
              className="grid items-center gap-4 px-3 py-2 md:grid-cols-[1fr_auto_auto_auto]"
            >
              <div>
                <p className="font-medium">{organization.name}</p>
                <p className="text-sm text-muted-foreground">
                  {organization.baseUrl}
                </p>
              </div>
              <div className="text-left text-sm md:text-right">
                <p className="text-muted-foreground">Auth</p>
                <p className="font-medium">
                  {formatAuthProvider(organization.authProvider)}
                </p>
              </div>
              <div className="text-left text-sm md:text-right">
                <p className="text-muted-foreground">Authenticated user</p>
                <p className="font-medium">
                  {organization.authenticatedUserDisplayName ?? "Unknown"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingDelete(organization)}
                disabled={deleteMutation.isPending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                aria-label={`Remove ${organization.name}`}
                title={`Remove ${organization.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          title="Remove organization"
          message={`Remove "${pendingDelete.name}"? This deletes its stored credential and cannot be undone.`}
          confirmLabel="Remove"
          destructive
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteMutation.mutate({ id: pendingDelete.id });
            setPendingDelete(null);
          }}
        />
      ) : null}
    </div>
  );
}

function QuickPipelinesSettings({ organizations }: { organizations: Organization[] }) {
  const [pipelines, setPipelines] = useState<QuickPipeline[]>(() => loadQuickPipelines());
  const [organizationId, setOrganizationId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [definitionId, setDefinitionId] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState(DEFAULT_QUICK_PIPELINE_BRANCH);
  const [formError, setFormError] = useState<string | null>(null);

  // Default the org picker to the first organization once they load.
  useEffect(() => {
    if (!organizationId && organizations.length > 0) {
      setOrganizationId(organizations[0].id);
    }
  }, [organizations, organizationId]);

  const projectsQuery = useQuery({
    queryKey: ["pipelineProjects", organizationId],
    queryFn: () => listPipelineProjects({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  const definitionsQuery = useQuery({
    queryKey: ["pipelineDefinitions", organizationId, projectId],
    queryFn: () => listPipelineDefinitions({ organizationId, projectId }),
    enabled: !!organizationId && !!projectId,
    staleTime: 5 * 60_000,
  });

  const projectOptions = useMemo<SelectOption[]>(
    () => (projectsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    [projectsQuery.data],
  );
  const definitionOptions = useMemo<SelectOption[]>(
    () => (definitionsQuery.data ?? []).map((d) => ({ value: String(d.id), label: d.name })),
    [definitionsQuery.data],
  );

  function persist(next: QuickPipeline[]) {
    setPipelines(next);
    saveQuickPipelines(next);
    emitQuickPipelinesChanged();
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const project = projectsQuery.data?.find((p) => p.id === projectId);
    const definition = definitionsQuery.data?.find((d) => String(d.id) === definitionId);
    if (!organizationId || !project || !definition) {
      setFormError("Select an organization, project, and pipeline.");
      return;
    }
    if (!branch.trim()) {
      setFormError("A source branch is required.");
      return;
    }
    const next = addQuickPipeline(pipelines, {
      name: name.trim() || definition.name,
      organizationId,
      projectId: project.id,
      projectName: project.name,
      definitionId: definition.id,
      definitionName: definition.name,
      sourceBranch: branch.trim(),
    });
    persist(next);
    setName("");
    setBranch(DEFAULT_QUICK_PIPELINE_BRANCH);
    setDefinitionId("");
  }

  function onRemove(id: string) {
    persist(removeQuickPipeline(pipelines, id));
  }

  const orgName = (id: string) => organizations.find((org) => org.id === id)?.name ?? id;

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Play className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Quick Pipelines</h2>
            <p className="text-sm text-muted-foreground">
              Register pipelines to run them from the command palette (Ctrl+K).
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onAdd}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Organization</span>
            <FilterableSelect
              ariaLabel="Quick pipeline organization"
              value={organizationId}
              options={organizations.map((org) => ({ value: org.id, label: org.name }))}
              onChange={(value) => {
                setOrganizationId(value);
                setProjectId("");
                setDefinitionId("");
              }}
              placeholder="Select organization"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Project</span>
            <FilterableSelect
              ariaLabel="Quick pipeline project"
              value={projectId}
              options={projectOptions}
              disabled={!organizationId || projectsQuery.isLoading}
              onChange={(value) => {
                setProjectId(value);
                setDefinitionId("");
              }}
              placeholder={projectsQuery.isLoading ? "Loading projects…" : "Select project"}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Pipeline</span>
            <FilterableSelect
              ariaLabel="Quick pipeline definition"
              value={definitionId}
              options={definitionOptions}
              disabled={!projectId || definitionsQuery.isLoading}
              onChange={setDefinitionId}
              placeholder={definitionsQuery.isLoading ? "Loading pipelines…" : "Select pipeline"}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Source branch</span>
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder={DEFAULT_QUICK_PIPELINE_BRANCH}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-sm font-medium">Display name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Defaults to the pipeline name"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>

        {projectsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(projectsQuery.error)}
          </p>
        ) : null}
        {definitionsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(definitionsQuery.error)}
          </p>
        ) : null}
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={!definitionId}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add pipeline
          </button>
        </div>
      </form>

      {pipelines.length > 0 ? (
        <div className="divide-y divide-border border-t border-border">
          {pipelines.map((pipeline) => (
            <div
              key={pipeline.id}
              className="grid items-center gap-3 px-3 py-2 md:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{pipeline.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {orgName(pipeline.organizationId)} / {pipeline.projectName} /{" "}
                  {pipeline.definitionName} · {shortQuickBranch(pipeline.sourceBranch)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(pipeline.id)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${pipeline.name}`}
                title={`Remove ${pipeline.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function shortQuickBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, "");
}

function SyncHealthSettings({ organizations }: { organizations: Organization[] }) {
  const queryClient = useQueryClient();
  const statesQuery = useQuery({
    queryKey: ["syncStates"],
    queryFn: listSyncStates,
    staleTime: 30_000,
  });
  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["syncStates"] });
    },
  });

  const states = statesQuery.data ?? [];
  const orgNames = new Map(organizations.map((org) => [org.id, org.name]));

  function syncScope(state: SyncState): SyncScope {
    if (state.scope.startsWith("prs:")) return "myReviews";
    if (state.scope.startsWith("work_items:")) return "myWorkItems";
    if (state.scope.startsWith("commits:")) return "commits";
    return "all";
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Sync health</h2>
            <p className="text-sm text-muted-foreground">
              Last successful background sync by cache scope.
            </p>
          </div>
        </div>
      </div>

      <div className="p-3">
        {statesQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading sync state
          </div>
        ) : statesQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(statesQuery.error)}
          </p>
        ) : states.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">No sync has completed yet.</span>
            <button
              type="button"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate({ scope: "all" })}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Sync all
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {states.map((state) => {
              const hasError = state.errorCount > 0;
              const hasWarning = !hasError && Boolean(state.lastWarning);
              return (
                <div
                  key={state.scope}
                  className="grid gap-3 bg-card px-3 py-2 text-sm md:grid-cols-[1fr_140px_100px_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{formatSyncScope(state.scope)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {orgNames.get(state.orgId) ?? state.orgId}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Last success</p>
                    <p className="font-medium">{formatSyncTime(state.lastSyncedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p
                      className={
                        hasError
                          ? "font-medium text-destructive"
                          : hasWarning
                            ? "font-medium text-amber-700 dark:text-amber-400"
                            : "font-medium text-green-700 dark:text-green-400"
                      }
                    >
                      {hasError ? `${state.errorCount} failed` : hasWarning ? "Limited" : "Healthy"}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {state.lastError ? (
                      <span
                        className="max-w-52 truncate text-xs text-destructive"
                        title={state.lastError}
                      >
                        {state.lastError}
                      </span>
                    ) : null}
                    {!state.lastError && state.lastWarning ? (
                      <span
                        className="max-w-52 truncate text-xs text-amber-700 dark:text-amber-400"
                        title={state.lastWarning}
                      >
                        {state.lastWarning}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={syncMutation.isPending}
                      onClick={() => syncMutation.mutate({ scope: syncScope(state) })}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                      Refresh
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {syncMutation.isError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {commandErrorMessage(syncMutation.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatSyncScope(scope: string): string {
  if (scope.startsWith("prs:")) return "Pull requests / My Reviews";
  if (scope.startsWith("work_items:")) return "Work items / My Items";
  if (scope.startsWith("commits:")) return "Commits";
  return scope;
}

function formatSyncTime(value: string | null): string {
  if (!value) return "Never";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(value).toLocaleString();
}

function DataCacheSettings() {
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(0);
  const queryCount = queryClient.getQueryCache().getAll().length;
  const azdodeckStorageEntries = Object.keys(window.localStorage).filter((key) =>
    key.startsWith("azdodeck:"),
  );
  const layoutStorageEntries = azdodeckStorageEntries.filter((key) =>
    key.startsWith(LAYOUT_STORAGE_PREFIX),
  );
  const localStorageBytes = azdodeckStorageEntries.reduce((total, key) => {
    const value = window.localStorage.getItem(key) ?? "";
    return total + key.length + value.length;
  }, 0);

  function refreshStats() {
    setRevision((value) => value + 1);
  }

  function clearDataCache() {
    queryClient.clear();
    refreshStats();
  }

  function resetLayoutCache() {
    clearLayoutStorage();
    refreshStats();
    // Widths live in component state across the app; reload so every sidebar,
    // preview, and grid re-initializes from its default width.
    window.location.reload();
  }

  return (
    <div className="rounded-md border border-border bg-card" data-cache-revision={revision}>
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Data cache</h2>
        <p className="text-sm text-muted-foreground">
          Clear cached server responses without removing organizations or saved WIQL views.
        </p>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="grid gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Query cache:</span>{" "}
            <span className="font-medium">{queryCount} entries</span>
          </p>
          <p>
            <span className="text-muted-foreground">Local UI storage:</span>{" "}
            <span className="font-medium">{formatBytes(localStorageBytes)}</span>
            <span className="text-muted-foreground"> across {azdodeckStorageEntries.length} keys</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clearDataCache}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary"
          >
            Clear data cache
          </button>
          <button
            type="button"
            onClick={resetLayoutCache}
            disabled={layoutStorageEntries.length === 0}
            title="Restore sidebar, preview, and grid column widths to their defaults. Saved Work Item Views and credentials are kept."
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset layout widths
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function settingsInput(
  settings: AppSettings | undefined,
  input: UpdateAppSettingsInput,
): UpdateAppSettingsInput {
  return {
    reviewResultFolderPath: settings?.reviewResultFolderPath ?? null,
    showWindowHotkey: settings?.showWindowHotkey ?? null,
    readOnlyValidationModeEnabled:
      settings?.readOnlyValidationModeEnabled ?? false,
    desktopNotificationsEnabled: settings?.desktopNotificationsEnabled ?? false,
    notificationContentPreviewEnabled:
      settings?.notificationContentPreviewEnabled ?? true,
    notifyWorkItemAssignments: settings?.notifyWorkItemAssignments ?? true,
    notifyWorkItemStateChanges: settings?.notifyWorkItemStateChanges ?? true,
    notifyPrReviewRequests: settings?.notifyPrReviewRequests ?? true,
    notifyPrVoteResets: settings?.notifyPrVoteResets ?? true,
    notifyPrCommentReplies: settings?.notifyPrCommentReplies ?? true,
    reviewStaleThresholdDays:
      settings?.reviewStaleThresholdDays ?? DEFAULT_REVIEW_STALE_THRESHOLD_DAYS,
    workItemStaleThresholdDays:
      settings?.workItemStaleThresholdDays ??
      DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS,
    notificationRules: settings?.notificationRules ?? [],
    ...input,
  };
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function ThemeSettings() {
  const [preference, setPreference] = useState<ThemePreference>(loadThemePreference);

  // Reflect changes made elsewhere (e.g. OS scheme follow) without re-reading.
  useEffect(() => {
    function onThemeChanged() {
      setPreference(loadThemePreference());
    }
    window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged);
  }, []);

  function selectTheme(next: ThemePreference) {
    setPreference(next);
    setThemePreference(next);
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Palette className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Appearance</h2>
            <p className="text-sm text-muted-foreground">
              Choose a theme. System follows your operating system setting.
            </p>
          </div>
        </div>
      </div>

      <div className="p-3">
        <div
          role="radiogroup"
          aria-label="Theme"
          className="inline-flex gap-1 rounded-md border border-border bg-muted p-0.5"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectTheme(value)}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${
                  selected
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ValidationModeSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(settingsQuery.data?.readOnlyValidationModeEnabled ?? false);
  }, [settingsQuery.data?.readOnlyValidationModeEnabled]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(
      settingsInput(settingsQuery.data, {
        readOnlyValidationModeEnabled: enabled,
      }),
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Validation mode</h2>
            <p className="text-sm text-muted-foreground">
              Use real sync, search, and previews while blocking Azure DevOps writes.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Read-only validation mode
        </label>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Validation mode saved.</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function DesktopNotificationSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [enabled, setEnabled] = useState(false);
  const [contentPreviewEnabled, setContentPreviewEnabled] = useState(true);
  const [assignmentsEnabled, setAssignmentsEnabled] = useState(true);
  const [stateChangesEnabled, setStateChangesEnabled] = useState(true);
  const [prReviewRequests, setPrReviewRequests] = useState(true);
  const [prVoteResets, setPrVoteResets] = useState(true);
  const [prCommentReplies, setPrCommentReplies] = useState(true);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    const settings = settingsQuery.data;
    setEnabled(settings?.desktopNotificationsEnabled ?? false);
    setContentPreviewEnabled(settings?.notificationContentPreviewEnabled ?? true);
    setAssignmentsEnabled(settings?.notifyWorkItemAssignments ?? true);
    setStateChangesEnabled(settings?.notifyWorkItemStateChanges ?? true);
    setPrReviewRequests(settings?.notifyPrReviewRequests ?? true);
    setPrVoteResets(settings?.notifyPrVoteResets ?? true);
    setPrCommentReplies(settings?.notifyPrCommentReplies ?? true);
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTestResult(null);
    mutation.mutate(
      settingsInput(settingsQuery.data, {
        desktopNotificationsEnabled: enabled,
        notificationContentPreviewEnabled: contentPreviewEnabled,
        notifyWorkItemAssignments: assignmentsEnabled,
        notifyWorkItemStateChanges: stateChangesEnabled,
        notifyPrReviewRequests: prReviewRequests,
        notifyPrVoteResets: prVoteResets,
        notifyPrCommentReplies: prCommentReplies,
      }),
    );
  }

  async function onSendTestNotification() {
    setTestResult(null);
    const result = await sendTestDesktopNotification();
    if (result === "sent") {
      setTestResult("Test notification sent.");
    } else if (result === "unsupported") {
      setTestResult("Desktop notifications are not supported in this runtime.");
    } else {
      setTestResult("Desktop notification permission was not granted.");
    }
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Desktop notifications</h2>
            <p className="text-sm text-muted-foreground">
              Notify after sync about work item changes and pull request review
              requests, vote resets, and replies.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Enable desktop notifications
        </label>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={assignmentsEnabled}
              onChange={(event) => setAssignmentsEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Assigned work items
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={stateChangesEnabled}
              onChange={(event) => setStateChangesEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            State changes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={contentPreviewEnabled}
              onChange={(event) => setContentPreviewEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Show title in notification
          </label>
        </div>
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium">Pull requests</p>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prReviewRequests}
                onChange={(event) => setPrReviewRequests(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              New review requests
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prVoteResets}
                onChange={(event) => setPrVoteResets(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Vote resets
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prCommentReplies}
                onChange={(event) => setPrCommentReplies(event.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Comment replies &amp; mentions
            </label>
          </div>
        </div>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Desktop notification settings saved.</p>
        ) : null}

        {testResult ? <p className="text-sm text-muted-foreground">{testResult}</p> : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Bell className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              void onSendTestNotification();
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-secondary"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Send test
          </button>
        </div>
      </form>
    </div>
  );
}

export function ReviewResultFolderSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [folderPath, setFolderPath] = useState("");

  useEffect(() => {
    setFolderPath(settingsQuery.data?.reviewResultFolderPath ?? "");
  }, [settingsQuery.data?.reviewResultFolderPath]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
      void queryClient.invalidateQueries({ queryKey: ["reviewResultPreview"] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(settingsInput(settingsQuery.data, { reviewResultFolderPath: folderPath }));
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Review result previews</h2>
            <p className="text-sm text-muted-foreground">
              Local HTML files matched by PR number.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Folder path</span>
          <input
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            placeholder="C:\\reports\\azdo-reviews"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Review result folder saved.</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

export function ReviewStaleThresholdSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  const value =
    settingsQuery.data?.reviewStaleThresholdDays ??
    DEFAULT_REVIEW_STALE_THRESHOLD_DAYS;

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const days = Number(event.target.value);
    mutation.mutate(
      settingsInput(settingsQuery.data, { reviewStaleThresholdDays: days }),
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">My Reviews</h2>
            <p className="text-sm text-muted-foreground">
              Highlight review requests as stale after this many days.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Stale review threshold</span>
          <select
            value={value}
            onChange={onChange}
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {REVIEW_STALE_THRESHOLD_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            Stale review threshold saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Comma-separated text <-> string[] for the project / repository filters. Empty
// segments are kept while editing; the backend trims and drops blanks on save.
function rulesListToText(values: string[]): string {
  return values.join(", ");
}
function rulesTextToList(text: string): string[] {
  return text.split(",").map((value) => value.trim());
}

export function NotificationRulesSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  const savedRules = settingsQuery.data?.notificationRules;
  const [draft, setDraft] = useState<NotificationRule[]>([]);

  // Keep the editable draft in step with the server copy whenever it loads or
  // changes elsewhere.
  useEffect(() => {
    if (savedRules) setDraft(savedRules);
  }, [savedRules]);

  function toggleType(index: number, value: string) {
    setDraft((rules) =>
      rules.map((rule, i) =>
        i === index
          ? {
              ...rule,
              types: rule.types.includes(value)
                ? rule.types.filter((type) => type !== value)
                : [...rule.types, value],
            }
          : rule,
      ),
    );
  }

  function setListField(
    index: number,
    field: "projects" | "repositories",
    text: string,
  ) {
    setDraft((rules) =>
      rules.map((rule, i) =>
        i === index ? { ...rule, [field]: rulesTextToList(text) } : rule,
      ),
    );
  }

  function addRule() {
    setDraft((rules) => [...rules, { types: [], projects: [], repositories: [] }]);
  }

  function removeRule(index: number) {
    setDraft((rules) => rules.filter((_, i) => i !== index));
  }

  function save() {
    mutation.mutate(settingsInput(settingsQuery.data, { notificationRules: draft }));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedRules ?? []);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Notification rules</h2>
            <p className="text-sm text-muted-foreground">
              Only deliver desktop notifications that match a rule. With no rules,
              the per-type toggles above apply. Repository filters apply to pull
              requests only.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules — every enabled notification is delivered.
          </p>
        ) : (
          draft.map((rule, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Rule {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label={`Remove rule ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <fieldset className="grid gap-1">
                <legend className="text-xs font-medium text-muted-foreground">
                  Notification types (any if none selected)
                </legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {NOTIFICATION_RULE_TYPES.map((type) => (
                    <label
                      key={type.value}
                      className="flex cursor-pointer items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={rule.types.includes(type.value)}
                        onChange={() => toggleType(index, type.value)}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-input"
                      />
                      {type.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Projects (comma separated; any if blank)
                </span>
                <input
                  value={rulesListToText(rule.projects)}
                  onChange={(event) =>
                    setListField(index, "projects", event.target.value)
                  }
                  placeholder="Platform, Mobile"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Repositories (comma separated; pull requests only)
                </span>
                <input
                  value={rulesListToText(rule.repositories)}
                  onChange={(event) =>
                    setListField(index, "repositories", event.target.value)
                  }
                  placeholder="web-app, api"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
          ))
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addRule}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add rule
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || mutation.isPending}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save rules
          </button>
        </div>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess && !dirty ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            Notification rules saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function WorkItemStaleThresholdSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  const value =
    settingsQuery.data?.workItemStaleThresholdDays ??
    DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS;

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const days = Number(event.target.value);
    mutation.mutate(
      settingsInput(settingsQuery.data, { workItemStaleThresholdDays: days }),
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">My Work Items</h2>
            <p className="text-sm text-muted-foreground">
              Flag active work items as stale after this many days without a change.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Stale work item threshold</span>
          <select
            value={value}
            onChange={onChange}
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            Stale work item threshold saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ShowWindowHotkeySettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [hotkey, setHotkey] = useState("");

  useEffect(() => {
    setHotkey(settingsQuery.data?.showWindowHotkey ?? "");
  }, [settingsQuery.data?.showWindowHotkey]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(settingsInput(settingsQuery.data, { showWindowHotkey: hotkey }));
  }

  function handleHotkeyKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape")
    ) {
      event.preventDefault();
      setHotkey("");
      return;
    }

    const nextHotkey = hotkeyFromKeyboardEvent(event);
    if (!nextHotkey) return;
    event.preventDefault();
    setHotkey(nextHotkey);
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Show window hotkey</h2>
            <p className="text-sm text-muted-foreground">
              Bring AzDoDeck to the front from anywhere.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Hotkey</span>
          <input
            aria-label="Show window hotkey"
            value={hotkey}
            onChange={(event) => setHotkey(event.target.value)}
            onKeyDown={handleHotkeyKeyDown}
            placeholder="Ctrl+Alt+D"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Press a key combination or type it manually. Leave blank to disable.
        </p>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Show window hotkey saved.</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Keyboard className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function hotkeyFromKeyboardEvent(
  event: ReactKeyboardEvent<HTMLInputElement>,
): string | null {
  const key = normalizeHotkeyKey(event.key);
  if (!key || isModifierKey(key)) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

function normalizeHotkeyKey(key: string): string | null {
  if (!key) return null;
  if (key === " " || key === "Spacebar") return "Space";
  if (key === "Esc") return "Escape";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function isModifierKey(key: string): boolean {
  return (
    key === "Control" ||
    key === "Ctrl" ||
    key === "Alt" ||
    key === "Shift" ||
    key === "Meta"
  );
}

function KeyboardShortcutSettings() {
  const defaults = defaultKeybindingMap();
  const [savedMap, setSavedMap] = useState<KeybindingMap>(resolveKeybindings);
  const [draft, setDraft] = useState<KeybindingMap>(savedMap);
  const [capturingId, setCapturingId] = useState<KeybindingId | null>(null);
  const [saved, setSaved] = useState(false);

  const conflicts = findConflicts(draft);
  const hasConflict = conflicts.size > 0;
  const dirty = KEYBINDINGS.some(
    (binding) => !binding.reserved && draft[binding.id] !== savedMap[binding.id],
  );

  function setCombo(id: KeybindingId, combo: string) {
    setSaved(false);
    setDraft((current) => ({ ...current, [id]: combo }));
  }

  function onCaptureKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: KeybindingId,
  ) {
    // Not capturing yet: only Enter/Space arms capture, so merely tabbing onto
    // the button (or any other key) never starts a capture (issue #445).
    if (capturingId !== id) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setCapturingId(id);
      }
      return;
    }
    // Tab leaves the field and cancels capture instead of being bound, so the
    // user can move focus normally while armed.
    if (event.key === "Tab") {
      setCapturingId(null);
      return;
    }
    // Escape cancels capture without changing the binding.
    if (event.key === "Escape") {
      event.preventDefault();
      setCapturingId(null);
      (event.target as HTMLButtonElement).blur();
      return;
    }
    const combo = comboFromEvent(event);
    if (!combo) return; // modifier-only press: keep waiting
    event.preventDefault();
    setCombo(id, combo);
    setCapturingId(null);
  }

  function resetOne(id: KeybindingId) {
    setCombo(id, defaults[id]);
  }

  function resetAll() {
    setSaved(false);
    setDraft(defaultKeybindingMap());
  }

  function onSave() {
    if (hasConflict) return;
    const overrides: Partial<KeybindingMap> = {};
    for (const binding of KEYBINDINGS) {
      if (binding.reserved) continue;
      overrides[binding.id] = draft[binding.id];
    }
    saveKeybindingOverrides(overrides);
    const next = resolveKeybindings();
    setSavedMap(next);
    setDraft(next);
    setSaved(true);
  }

  // Group bindings for display in declaration order.
  const groups: { group: string; ids: KeybindingId[] }[] = [];
  for (const binding of KEYBINDINGS) {
    let bucket = groups.find((g) => g.group === binding.group);
    if (!bucket) {
      bucket = { group: binding.group, ids: [] };
      groups.push(bucket);
    }
    bucket.ids.push(binding.id);
  }
  const bindingById = new Map(KEYBINDINGS.map((b) => [b.id, b]));

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
            <p className="text-sm text-muted-foreground">
              Reassign app-level shortcuts. Focus a shortcut and press the new key combination.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        {groups.map(({ group, ids }) => (
          <div key={group} className="grid gap-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group}
            </p>
            {ids.map((id) => {
              const binding = bindingById.get(id)!;
              const conflictIds = conflicts.get(id);
              const reserved = binding.reserved ?? false;
              const isDefault = draft[id] === defaults[id];
              return (
                <div key={id} className="grid gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">{binding.label}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={reserved}
                        aria-label={`Shortcut for ${binding.label}${
                          capturingId === id ? " (press keys, Esc to cancel)" : " (Enter to rebind)"
                        }`}
                        onClick={() => !reserved && setCapturingId(id)}
                        onBlur={() => setCapturingId((current) => (current === id ? null : current))}
                        onKeyDown={(event) => !reserved && onCaptureKeyDown(event, id)}
                        className={`h-8 min-w-[7rem] rounded-md border px-2 text-xs font-mono outline-none focus:ring-2 focus:ring-ring ${
                          conflictIds
                            ? "border-destructive text-destructive"
                            : "border-input bg-background"
                        } ${reserved ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {capturingId === id ? "Press keys…" : draft[id] || "—"}
                      </button>
                      <button
                        type="button"
                        disabled={reserved || isDefault}
                        onClick={() => resetOne(id)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  {conflictIds ? (
                    <p role="alert" className="text-xs text-destructive">
                      Conflicts with {conflictIds.map((other) => keybindingLabel(other)).join(", ")}.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}

        {hasConflict ? (
          <p role="alert" className="text-sm text-destructive">
            Resolve the highlighted conflicts before saving.
          </p>
        ) : null}
        {saved ? (
          <p className="text-sm text-green-700 dark:text-green-400">Keyboard shortcuts saved.</p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={hasConflict || !dirty}
            onClick={onSave}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Save shortcuts
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
          >
            Reset all to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

export function SetupPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [organization, setOrganization] = useState("");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function onOrganizationConnected() {
    setOrganization("");
    setPat("");
    setValidationError(null);
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
  }

  const patMutation = useMutation({
    mutationFn: addPatOrganization,
    onSuccess: onOrganizationConnected,
  });

  const azureCliMutation = useMutation({
    mutationFn: addAzureCliOrganization,
    onSuccess: onOrganizationConnected,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    patMutation.reset();
    azureCliMutation.reset();
    if (!organization.trim() || !pat.trim()) {
      setValidationError("Organization and PAT are required.");
      return;
    }
    setValidationError(null);
    patMutation.mutate({ organization, pat });
  }

  function onConnectAzureCli() {
    patMutation.reset();
    azureCliMutation.reset();
    if (!organization.trim()) {
      setValidationError("Organization is required.");
      return;
    }
    setValidationError(null);
    azureCliMutation.mutate({ organization });
  }

  const isConnecting = patMutation.isPending || azureCliMutation.isPending;

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {compact ? "Add organization" : "Connect Azure DevOps"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Credentials are validated before they are saved.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Organization</span>
          <input
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            placeholder="contoso"
            autoFocus={!compact}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Personal access token</span>
          <div className="flex h-9 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <input
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              type={showPat ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPat((value) => !value)}
              className="flex w-10 items-center justify-center border-l border-border text-muted-foreground hover:bg-secondary"
              aria-label={showPat ? "Hide PAT" : "Show PAT"}
            >
              {showPat ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </label>

        {validationError ? (
          <p role="alert" className="text-sm text-destructive">
            {validationError}
          </p>
        ) : null}

        {patMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(patMutation.error)}
          </p>
        ) : null}

        {azureCliMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(azureCliMutation.error)}
          </p>
        ) : null}

        {patMutation.isSuccess || azureCliMutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Organization connected.</p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isConnecting}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {patMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Connect
          </button>
          <button
            type="button"
            disabled={isConnecting}
            onClick={onConnectAzureCli}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {azureCliMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Building2 className="h-4 w-4" aria-hidden="true" />
            )}
            Connect with Azure CLI
          </button>
        </div>
      </form>
    </div>
  );
}

function formatAuthProvider(value: string): string {
  return value === "azure_cli" ? "Azure CLI" : value.toUpperCase();
}
