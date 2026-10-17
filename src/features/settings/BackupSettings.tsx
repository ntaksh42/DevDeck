import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatabaseBackup } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getAppSettings, updateAppSettings } from "@/lib/azdoCommands";
import { isTauriRuntime } from "@/lib/runtime";
import { settingsInput } from "./settingsHelpers";
import {
  BACKUP_GROUPS,
  APP_SETTINGS_KEY,
  applyBackup,
  buildBackup,
  countEntries,
  notificationBackupValue,
  notificationPatch,
  parseBackup,
  type ImportMode,
  type SettingsBackup,
} from "@/lib/settingsBackup";

const MODE_LABELS: Record<ImportMode, string> = {
  overwrite: "Overwrite",
  merge: "Merge",
  skip: "Skip",
};

async function saveBackupFile(text: string): Promise<string> {
  const fileName = `devdeck-settings-${new Date().toISOString().slice(0, 10)}.json`;
  if (isTauriRuntime()) {
    const path = await save({
      title: "Export settings",
      defaultPath: fileName,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return "Export cancelled.";
    await writeTextFile(path, text);
    return "Exported settings.";
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return "Exported settings.";
}

export function BackupSettings() {
  const [selected, setSelected] = useState<string[]>(BACKUP_GROUPS.map((group) => group.id));
  const [pending, setPending] = useState<SettingsBackup | null>(null);
  const [modes, setModes] = useState<Record<string, ImportMode>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });

  function report(text: string, isError = false) {
    setMessage(text);
    setFailed(isError);
  }

  async function exportSettings() {
    try {
      const settings = settingsQuery.data;
      const extra: Record<string, string> = settings ? { [APP_SETTINGS_KEY]: notificationBackupValue(settings) } : {};
      report(await saveBackupFile(JSON.stringify(buildBackup(selected, new Date(), extra), null, 2)));
    } catch (error) {
      report(error instanceof Error ? error.message : "Failed to export settings.", true);
    }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      if (Object.keys(backup.groups).length === 0) throw new Error("This backup has no settings to import.");
      setPending(backup);
      setModes(Object.fromEntries(Object.keys(backup.groups).map((id) => [id, "skip" as const])));
      report(`Choose how to apply each group (exported ${backup.exportedAt || "at an unknown time"}).`);
    } catch (error) {
      setPending(null);
      report(error instanceof Error ? error.message : "Failed to read the file.", true);
    }
  }

  async function importSettings() {
    if (!pending) return;
    try {
      let written = applyBackup(pending, modes);
      // Notification rules live in the app settings, so they go through the backend.
      const mode = modes.notifications ?? "skip";
      const raw = pending.groups.notifications?.[APP_SETTINGS_KEY];
      if (raw && mode !== "skip" && settingsQuery.data) {
        await updateAppSettings(
          settingsInput(settingsQuery.data, notificationPatch(settingsQuery.data, raw, mode)),
        );
        written += 1;
      }
      if (written === 0) {
        report("Nothing was applied: every group is set to Skip.");
        return;
      }
      // Panels hold their settings in component state, so reload to pick them up.
      window.location.reload();
    } catch (error) {
      report(error instanceof Error ? error.message : "Failed to apply the settings.", true);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <DatabaseBackup className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Backup</h2>
            <p className="text-sm text-muted-foreground">
              Move personal settings to another PC. Connections, tokens, local paths and caches are never included.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Export</legend>
          {BACKUP_GROUPS.map((group) => (
            <label key={group.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(group.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id),
                  )
                }
              />
              {group.label}
            </label>
          ))}
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={() => void exportSettings()}
            className="mt-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Export to file…
          </button>
        </fieldset>

        <div className="space-y-1">
          <p className="text-sm font-medium">Import</p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Settings backup file"
            className="text-sm"
            onChange={(event) => void chooseFile(event.target.files?.[0])}
          />
          {pending ? (
            <div className="space-y-1 pt-1">
              {BACKUP_GROUPS.filter((group) => pending.groups[group.id]).map((group) => {
                const count = Object.values(pending.groups[group.id]).reduce(
                  (total, raw) => total + countEntries(raw),
                  0,
                );
                return (
                  <div key={group.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1">
                      {group.label} <span className="text-muted-foreground">({count})</span>
                    </span>
                    <select
                      aria-label={`${group.label} import mode`}
                      value={modes[group.id] ?? "skip"}
                      onChange={(event) =>
                        setModes((current) => ({ ...current, [group.id]: event.target.value as ImportMode }))
                      }
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                    >
                      {(Object.keys(MODE_LABELS) as ImportMode[]).map((mode) => (
                        <option key={mode} value={mode}>
                          {MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => void importSettings()}
                className="mt-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Apply and reload
              </button>
            </div>
          ) : null}
        </div>

        {message ? (
          <p role="status" className={`text-sm ${failed ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
