import { openUrl } from "@tauri-apps/plugin-opener";
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
