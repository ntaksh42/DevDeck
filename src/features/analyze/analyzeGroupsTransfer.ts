// Export/import for analyze groups, mirroring the work item views transfer so
// the two share one mental model.

import {
  createAnalyzeGroupId,
  createAnalyzeGroupsExport,
  parseAnalyzeGroupsImport,
  type AnalyzeGroup,
} from "./analyzeGroupsStorage";

export function analyzeGroupsExportFileName(now: Date = new Date()): string {
  return `azdodeck-analyze-groups-${now.toISOString().slice(0, 10)}.json`;
}

/** Downloads every group as a JSON file, returning the status message. */
export function downloadAnalyzeGroupsExport(groups: AnalyzeGroup[]): string {
  const text = JSON.stringify(createAnalyzeGroupsExport(groups), null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = analyzeGroupsExportFileName();
  link.click();
  URL.revokeObjectURL(url);
  return `${groups.length} 件のグループを書き出しました。`;
}

export type AnalyzeGroupsImportResult =
  | { status: "ok"; groups: AnalyzeGroup[]; message: string }
  | { status: "error"; message: string };

/** Parses an export file, giving every imported group a fresh id. */
export async function readAnalyzeGroupsImportFile(
  file: File,
): Promise<AnalyzeGroupsImportResult> {
  try {
    const groups = parseAnalyzeGroupsImport(await file.text()).map((group) => ({
      ...group,
      id: createAnalyzeGroupId(),
    }));
    return {
      status: "ok",
      groups,
      message: `${groups.length} 件のグループを読み込みました。`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "グループの読み込みに失敗しました。",
    };
  }
}
