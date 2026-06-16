import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { isTauriRuntime } from "@/lib/runtime";

export async function openExternalUrl(url: string): Promise<void> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Only http and https URLs can be opened.");
  }

  if (isTauriRuntime()) {
    await openUrl(parsedUrl.toString());
    return;
  }

  window.open(parsedUrl.toString(), "_blank", "noopener,noreferrer");
}

/** Opens a local file in its default OS handler (e.g. an HTML review result in
 * the browser). Only works in the desktop runtime; the browser dev preview has
 * no filesystem access. */
export async function openLocalPath(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("Opening local files is only available in the desktop app.");
  }
  await openPath(path);
}
