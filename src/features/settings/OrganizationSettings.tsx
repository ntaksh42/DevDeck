import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Eye, EyeOff, FileText, Keyboard, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  addAzureCliOrganization,
  addPatOrganization,
  deleteOrganization,
  getAppSettings,
  updateAppSettings,
  commandErrorMessage,
  type Organization,
} from '@/lib/azdoCommands';
export function OrganizationSettings({
  organizations,
}: {
  organizations: Organization[];
}) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: deleteOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });

  function onDelete(org: Organization) {
    if (!window.confirm(`Remove "${org.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate({ id: org.id });
  }

  return (
    <div className="space-y-3">
      <SetupPanel compact />
      <ShowWindowHotkeySettings />
      <ReviewResultFolderSettings />
      <DataCacheSettings />
      <div className="overflow-hidden rounded-md border border-border bg-white">
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
                onClick={() => onDelete(organization)}
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
    </div>
  );
}

function DataCacheSettings() {
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(0);
  const queryCount = queryClient.getQueryCache().getAll().length;
  const azdodeckStorageEntries = Object.keys(window.localStorage).filter((key) =>
    key.startsWith("azdodeck:"),
  );
  const layoutStorageEntries = azdodeckStorageEntries.filter((key) =>
    key.startsWith("azdodeck:layout:"),
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
    for (const key of layoutStorageEntries) {
      window.localStorage.removeItem(key);
    }
    refreshStats();
  }

  return (
    <div className="rounded-md border border-border bg-white" data-cache-revision={revision}>
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
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset layout cache
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
    mutation.mutate({
      reviewResultFolderPath: folderPath,
      showWindowHotkey: settingsQuery.data?.showWindowHotkey ?? null,
    });
  }

  return (
    <div className="rounded-md border border-border bg-white">
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
          <p className="text-sm text-green-700">Review result folder saved.</p>
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
    mutation.mutate({
      reviewResultFolderPath: settingsQuery.data?.reviewResultFolderPath ?? null,
      showWindowHotkey: hotkey,
    });
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
    <div className="rounded-md border border-border bg-white">
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
          <p className="text-sm text-green-700">Show window hotkey saved.</p>
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
    <div className="rounded-md border border-border bg-white">
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
          <p className="text-sm text-green-700">Organization connected.</p>
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
