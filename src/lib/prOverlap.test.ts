import { describe, expect, it } from "vitest";

import { detectFileOverlaps } from "./prOverlap";

describe("detectFileOverlaps", () => {
  it("reports no overlap for a single PR", () => {
    const result = detectFileOverlaps([
      { key: "repo:1", files: ["/a.ts", "/b.ts"] },
    ]);
    expect(result.overlaps).toEqual([]);
    expect(result.fileCount).toBe(0);
  });

  it("reports no overlap when PRs touch disjoint files", () => {
    const result = detectFileOverlaps([
      { key: "repo:1", files: ["/a.ts", "/b.ts"] },
      { key: "repo:2", files: ["/c.ts", "/d.ts"] },
    ]);
    expect(result.overlaps).toEqual([]);
    expect(result.fileCount).toBe(0);
  });

  it("detects a file touched by two PRs", () => {
    const result = detectFileOverlaps([
      { key: "repo:1", files: ["/a.ts", "/shared.ts"] },
      { key: "repo:2", files: ["/shared.ts", "/c.ts"] },
    ]);
    expect(result.fileCount).toBe(1);
    expect(result.overlaps).toEqual([
      { path: "/shared.ts", prKeys: ["repo:1", "repo:2"] },
    ]);
  });

  it("records every PR that touches a shared file in selection order", () => {
    const result = detectFileOverlaps([
      { key: "repo:1", files: ["/shared.ts"] },
      { key: "repo:2", files: ["/other.ts"] },
      { key: "repo:3", files: ["/shared.ts"] },
    ]);
    expect(result.overlaps).toEqual([
      { path: "/shared.ts", prKeys: ["repo:1", "repo:3"] },
    ]);
  });

  it("sorts overlapping files by path", () => {
    const result = detectFileOverlaps([
      { key: "repo:1", files: ["/z.ts", "/a.ts"] },
      { key: "repo:2", files: ["/z.ts", "/a.ts"] },
    ]);
    expect(result.overlaps.map((overlap) => overlap.path)).toEqual([
      "/a.ts",
      "/z.ts",
    ]);
    expect(result.fileCount).toBe(2);
  });

  it("does not treat a duplicate path within one PR as an overlap", () => {
    const result = detectFileOverlaps([
      { key: "repo:1", files: ["/a.ts", "/a.ts"] },
      { key: "repo:2", files: ["/b.ts"] },
    ]);
    expect(result.overlaps).toEqual([]);
    expect(result.fileCount).toBe(0);
  });
});
