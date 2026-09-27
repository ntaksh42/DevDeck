import { describe, expect, it } from "vitest";
import { shrinkToFit } from "@/lib/gridAutoFit";

describe("shrinkToFit", () => {
  it("returns the widths unchanged when nothing overflows", () => {
    const widths = [100, 200, 80];
    expect(shrinkToFit(widths, [50, 150, 60], 1, 0)).toBe(widths);
  });

  it("takes the overflow from the non-flexible columns first, by slack", () => {
    // Slack: col0 = 50, col2 = 50; flexible col1 keeps its width.
    expect(shrinkToFit([100, 200, 110], [50, 150, 60], 1, 40)).toEqual([80, 200, 90]);
  });

  it("shrinks the flexible column only after the others hit their minimums", () => {
    expect(shrinkToFit([100, 200, 110], [50, 150, 60], 1, 130)).toEqual([50, 170, 60]);
  });

  it("never goes below the minimums", () => {
    expect(shrinkToFit([100, 200, 110], [50, 150, 60], 1, 1000)).toEqual([50, 150, 60]);
  });
});
