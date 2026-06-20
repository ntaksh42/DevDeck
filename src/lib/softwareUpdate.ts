// Thin wrapper around the Tauri updater plugin, guarded so it is inert in the
// browser dev/demo runtime (where the plugin is unavailable). Opt-in: nothing
// runs until the user checks for updates. Failures are surfaced to the caller
// so the UI can skip safely rather than crash.

import { isTauriRuntime } from "./runtime";

export type AvailableUpdate = {
  version: string;
  currentVersion: string;
  notes?: string;
};

// Checks for a newer release. Returns the available update, or null when the
// app is up to date or the updater is unavailable (e.g. browser runtime).
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauriRuntime()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? undefined,
  };
}

// Downloads and installs the pending update, then relaunches the app. Throws on
// failure so the caller can report it and leave the current version running.
export async function installUpdateAndRelaunch(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) return;
  await update.downloadAndInstall();
  await relaunch();
}
