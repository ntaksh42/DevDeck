import { describe, expect, it } from "vitest";
import { hideColumnsToFit, shrinkToFit } from "@/lib/gridAutoFit";

describe("shrinkToFit", () => {
  it("returns the widths unchanged when nothing overflows", () => {
    const widths = [100, 200, 80];
    expect(shrinkToFit(widths, [50, 150, 60], 1, 0)).toBe(widths);
  });

  it("takes the overflow from the flexible column first", () => {
    expect(shrinkToFit([100, 200, 110], [50, 150, 60], 1, 40)).toEqual([100, 160, 110]);
  });

  it("shrinks the others by slack only after the flexible column hits its minimum", () => {
    // Flexible col1 gives 50; the remaining 40 splits by slack (col0 = 50, col2 = 50).
    expect(shrinkToFit([100, 200, 110], [50, 150, 60], 1, 90)).toEqual([80, 150, 90]);
  });

  it("never goes below the minimums", () => {
    expect(shrinkToFit([100, 200, 110], [50, 150, 60], 1, 1000)).toEqual([50, 150, 60]);
  });
});

describe("hideColumnsToFit", () => {
  const widths: Record<string, number> = { id: 50, title: 200, author: 80, target: 70, role: 60 };
  const widthOf = (columns: string[]) => columns.reduce((sum, c) => sum + widths[c], 0);
  const columns = ["id", "title", "author", "target", "role"];

  it("keeps every column when they fit or the pane is not measured yet", () => {
    expect(hideColumnsToFit(columns, ["target", "role"], 460, widthOf)).toEqual(columns);
    expect(hideColumnsToFit(columns, ["target", "role"], null, widthOf)).toEqual(columns);
  });

  it("hides in order only as many columns as needed", () => {
    expect(hideColumnsToFit(columns, ["target", "role"], 400, widthOf)).toEqual(["id", "title", "author", "role"]);
    expect(hideColumnsToFit(columns, ["target", "role"], 300, widthOf)).toEqual(["id", "title", "author"]);
  });

  it("skips hide candidates the user already hid", () => {
    expect(hideColumnsToFit(["id", "title", "author", "role"], ["target", "role"], 300, widthOf)).toEqual([
      "id",
      "title",
      "author",
    ]);
  });
});
