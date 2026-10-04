import { describe, expect, it } from "vitest";
import { fuzzyScore, rankByFuzzy } from "./codeFuzzy";

describe("fuzzyScore", () => {
  it("matches substrings, case-insensitively", () => {
    expect(fuzzyScore("/src/lib/azdoCommands.ts", "AZDO")).not.toBeNull();
  });

  it("matches characters in order across the path", () => {
    expect(fuzzyScore("/src/features/code/CodeBrowseView.tsx", "cbv")).not.toBeNull();
    expect(fuzzyScore("/src/app.ts", "zzz")).toBeNull();
    expect(fuzzyScore("/src/app.ts", "ptt")).toBeNull();
  });

  it("ranks a file-name substring ahead of a directory substring ahead of a subsequence", () => {
    const name = fuzzyScore("/lib/utils/helper.ts", "helper")!;
    const dir = fuzzyScore("/helper/other.ts", "helper")!;
    const loose = fuzzyScore("/h/e/l/p/e/r.ts", "helper")!;
    expect(name).toBeLessThan(dir);
    expect(dir).toBeLessThan(loose);
  });
});

describe("rankByFuzzy", () => {
  const items = [
    { path: "/docs/readme.md" },
    { path: "/src/read/index.ts" },
    { path: "/src/lib/reader.ts" },
    { path: "/other.txt" },
  ];

  it("drops non-matches and puts the best match first", () => {
    expect(rankByFuzzy(items, "read").map((i) => i.path)).toEqual([
      "/docs/readme.md",
      "/src/lib/reader.ts",
      "/src/read/index.ts",
    ]);
  });

  it("returns every item for an empty needle", () => {
    expect(rankByFuzzy(items, "  ")).toEqual(items);
  });
});
