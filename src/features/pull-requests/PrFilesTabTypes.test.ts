import { describe, expect, it } from "vitest";
import type { PrChangedFile } from "@/lib/azdoCommands";
import { buildFileTreeRows, changeTypeMarker, filterFilesByQuery } from "./PrFilesTabTypes";

function file(path: string, changeType = "edit"): PrChangedFile {
  return { path, changeType, originalPath: null };
}

describe("changeTypeMarker", () => {
  it("marks add and undelete green plus", () => {
    expect(changeTypeMarker("add")?.symbol).toBe("+");
    expect(changeTypeMarker("undelete")?.symbol).toBe("+");
  });

  it("marks delete red minus", () => {
    expect(changeTypeMarker("delete")?.symbol).toBe("−");
  });

  it("marks rename purple arrow", () => {
    expect(changeTypeMarker("edit, rename")?.symbol).toBe("→");
  });

  it("has no marker for a plain edit", () => {
    expect(changeTypeMarker("edit")).toBeNull();
  });
});

describe("filterFilesByQuery", () => {
  const files = [file("src/features/pull-requests/PrFilesTab.tsx"), file("src/lib/diffView.ts")];

  it("returns every file for an empty query", () => {
    expect(filterFilesByQuery(files, "")).toEqual(files);
    expect(filterFilesByQuery(files, "   ")).toEqual(files);
  });

  it("matches case-insensitively against the full path", () => {
    expect(filterFilesByQuery(files, "PRFILES")).toEqual([files[0]]);
  });

  it("matches a path substring", () => {
    expect(filterFilesByQuery(files, "lib/diff")).toEqual([files[1]]);
  });
});

describe("buildFileTreeRows", () => {
  it("compresses a chain of single-child folders into one row", () => {
    const files = [file("src/features/pull-requests/PrFilesTab.tsx")];
    const { rows } = buildFileTreeRows(files, new Set());
    const folderRows = rows.filter((row) => row.kind === "folder");
    expect(folderRows).toHaveLength(1);
    expect(folderRows[0]).toMatchObject({ path: "src/features/pull-requests", name: "src/features/pull-requests" });
  });

  it("stops compressing at a folder with multiple subfolders or files of its own", () => {
    const files = [
      file("src/features/pull-requests/PrFilesTab.tsx"),
      file("src/features/work-items/WorkItemView.tsx"),
      file("src/lib/diffView.ts"),
    ];
    const { rows } = buildFileTreeRows(files, new Set());
    const folderPaths = rows.filter((row) => row.kind === "folder").map((row) => row.path);
    // "src" has two subfolders (features, lib) and no files of its own, so it
    // stays a single row; "features" branches into two subfolders too.
    expect(folderPaths).toContain("src");
    expect(folderPaths).toContain("src/features");
    expect(folderPaths).toContain("src/features/pull-requests");
    expect(folderPaths).toContain("src/features/work-items");
  });

  it("uses the merged path as the collapse key", () => {
    const files = [file("src/features/pull-requests/PrFilesTab.tsx")];
    const collapsed = new Set(["src/features/pull-requests"]);
    const { rows } = buildFileTreeRows(files, collapsed);
    const folderRow = rows.find((row) => row.kind === "folder");
    expect(folderRow).toMatchObject({ collapsed: true });
    // The file underneath a collapsed row is not emitted as a tree row.
    expect(rows.some((row) => row.kind === "file")).toBe(false);
  });

  it("keeps visibleFiles in full tree order regardless of collapse state", () => {
    const files = [
      file("src/features/pull-requests/PrFilesTab.tsx"),
      file("src/features/pull-requests/PrDiffPanel.tsx"),
      file("src/lib/diffView.ts"),
    ];
    const collapsed = new Set(["src/features/pull-requests"]);
    const { visibleFiles } = buildFileTreeRows(files, collapsed);
    expect(visibleFiles.map((f) => f.path)).toEqual([
      "src/features/pull-requests/PrDiffPanel.tsx",
      "src/features/pull-requests/PrFilesTab.tsx",
      "src/lib/diffView.ts",
    ]);
  });
});
