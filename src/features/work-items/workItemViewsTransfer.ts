import {
  createWorkItemQueryViewsExport,
  parseWorkItemQueryViewsImport,
  type WorkItemQueryView,
} from './workItemViewsStorage';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from '@/lib/runtime';
import { newWorkItemViewId, viewExportFileName } from './workItemViewsHelpers';

/** Copies a single view's share JSON, returning the status message to show. */
export async function copyViewShareJson(view: WorkItemQueryView): Promise<string> {
  const text = JSON.stringify(createWorkItemQueryViewsExport([view]), null, 2);
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API is not available.");
    }
    await navigator.clipboard.writeText(text);
    return "Copied selected view share JSON.";
  } catch (error) {
    return error instanceof Error ? error.message : "Failed to copy share JSON.";
  }
}

/** Saves every view as a JSON file, returning the status message to show. */
export async function downloadViewsExport(views: WorkItemQueryView[]): Promise<string> {
  const text = JSON.stringify(createWorkItemQueryViewsExport(views), null, 2);
  const fileName = viewExportFileName();

  if (isTauriRuntime()) {
    try {
      const path = await save({
        title: "Export work item views",
        defaultPath: fileName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return "Export cancelled.";
      await writeTextFile(path, text);
      return `Exported ${views.length} view${views.length === 1 ? "" : "s"}.`;
    } catch (error) {
      return error instanceof Error ? error.message : "Failed to export views.";
    }
  }

  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return `Exported ${views.length} view${views.length === 1 ? "" : "s"}.`;
}

export type ViewsImportResult =
  | { status: "ok"; views: WorkItemQueryView[]; message: string }
  | { status: "error"; message: string };

/** Parses an export file, giving every imported view a fresh id. */
export async function readViewsImportFile(file: File): Promise<ViewsImportResult> {
  try {
    const views = parseWorkItemQueryViewsImport(await file.text()).map((view) => ({
      ...view,
      id: newWorkItemViewId(),
    }));
    return {
      status: "ok",
      views,
      message: `Imported ${views.length} view${views.length === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to import views.",
    };
  }
}
