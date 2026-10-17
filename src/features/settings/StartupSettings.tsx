import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Power } from "lucide-react";
import {
  commandErrorMessage,
  getAppSettings,
  getAutostartEnabled,
  setAutostartEnabled,
  updateAppSettings,
} from "@/lib/azdoCommands";
import { isTauriRuntime } from "@/lib/runtime";
import { settingsInput } from "./settingsHelpers";

export function StartupSettings() {
  const queryClient = useQueryClient();
  const desktop = isTauriRuntime();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  // The OS registration is the truth: it can change outside DevDeck.
  const autostartQuery = useQuery({
    queryKey: ["autostartEnabled"],
    queryFn: getAutostartEnabled,
    enabled: desktop,
    staleTime: 0,
  });
  const autostartMutation = useMutation({
    mutationFn: setAutostartEnabled,
    onSuccess: (enabled) => queryClient.setQueryData(["autostartEnabled"], enabled),
  });
  const settingsMutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => queryClient.setQueryData(["appSettings"], settings),
  });

  const settings = settingsQuery.data;
  const error = [autostartQuery, autostartMutation, settingsMutation, settingsQuery].find(
    (query) => query.isError,
  )?.error;
  const busy = autostartMutation.isPending || settingsMutation.isPending;
  const disabled = !desktop || !settings || busy;

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Power className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Startup</h2>
            <p className="text-sm text-muted-foreground">
              Start with Windows and keep running in the tray so notifications still arrive.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-3">
        {desktop ? null : (
          <p className="text-sm text-muted-foreground">
            These options are only available in the desktop app.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autostartQuery.data ?? false}
            disabled={disabled}
            onChange={(event) => autostartMutation.mutate(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Start DevDeck when I sign in to Windows
        </label>
        <p className="pl-6 text-xs text-muted-foreground">
          Adds a DevDeck entry to the current user&apos;s Windows startup list (registry Run key).
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings?.startMinimized ?? false}
            disabled={disabled}
            onChange={(event) =>
              settingsMutation.mutate(settingsInput(settings, { startMinimized: event.target.checked }))
            }
            className="h-4 w-4 rounded border-input"
          />
          Start minimized (no window at sign-in)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings?.keepRunningInTray ?? false}
            disabled={disabled}
            onChange={(event) =>
              settingsMutation.mutate(
                settingsInput(settings, { keepRunningInTray: event.target.checked }),
              )
            }
            className="h-4 w-4 rounded border-input"
          />
          Keep running in the tray when the window is closed
        </label>
        <p className="pl-6 text-xs text-muted-foreground">
          The tray menu has Show, Sync now and Quit. Quit is the only way to exit while this is on.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
