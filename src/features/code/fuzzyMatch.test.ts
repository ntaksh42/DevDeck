import { describe, expect, it } from "vitest";
import { fuzzyFindFiles } from "./fuzzyMatch";

const PATHS = [
  "/src/features/code/CodeFileTree.tsx",
  "/src/features/code/CodeBrowseView.tsx",
  "/src/features/commits/CommitResults.tsx",
  "/README.md",
  "/package.json",
];

describe("fuzzyFindFiles", () => {
  it("matches non-contiguous characters in order", () => {
    const results = fuzzyFindFiles("cftree", PATHS);
    expect(results.map((r) => r.path)).toContain("/src/features/code/CodeFileTree.tsx");
  });

  it("excludes paths whose characters do not appear in order", () => {
    const results = fuzzyFindFiles("zzz", PATHS);
    expect(results).toEqual([]);
  });

  it("ranks an exact basename match above a same-substring match buried in the path", () => {
    const results = fuzzyFindFiles("readme", PATHS);
    expect(results[0]?.path).toBe("/README.md");
  });

  it("prefers basename matches over directory-only matches", () => {
    const results = fuzzyFindFiles("commit", PATHS);
    // "CommitResults.tsx" matches in the basename; the others only match
    // "commits" in a parent folder, never the filename itself.
    expect(results[0]?.path).toBe("/src/features/commits/CommitResults.tsx");
  });

  it("is case-insensitive", () => {
    const results = fuzzyFindFiles("PACKAGE", PATHS);
    expect(results.map((r) => r.path)).toContain("/package.json");
  });

  it("returns the first N paths unscored for an empty query", () => {
    const results = fuzzyFindFiles("", PATHS, 2);
    expect(results).toEqual([
      { path: PATHS[0], score: 0 },
      { path: PATHS[1], score: 0 },
    ]);
  });

  it("caps results at the given limit", () => {
    const manyPaths = Array.from({ length: 100 }, (_, i) => `/file-${i}.ts`);
    const results = fuzzyFindFiles("file", manyPaths, 10);
    expect(results.length).toBe(10);
  });
});
