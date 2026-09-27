import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_SECTION_LAYOUT,
  dropPreviewSection,
  normalizePreviewSectionLayout,
  PREVIEW_SECTION_IDS,
  type PreviewSectionId,
  sectionsInColumn,
  stepPreviewSection,
} from "./previewSectionLayout";

const allVisible = new Set<PreviewSectionId>(PREVIEW_SECTION_IDS);

describe("previewSectionLayout", () => {
  it("defaults to the historical order with comments in the side column", () => {
    expect(sectionsInColumn(DEFAULT_PREVIEW_SECTION_LAYOUT, "side")).toEqual(["comments"]);
    expect(sectionsInColumn(DEFAULT_PREVIEW_SECTION_LAYOUT, "main")).toEqual([
      "description",
      "acceptanceCriteria",
      "links",
      "pullRequests",
      "attachments",
      "history",
    ]);
  });

  it("normalizes stored layouts: drops unknown ids and appends missing ones", () => {
    expect(
      normalizePreviewSectionLayout({
        order: ["history", "bogus", "history", "links"],
        side: ["links", 3, "nope"],
      }),
    ).toEqual({
      order: [
        "history",
        "links",
        "description",
        "acceptanceCriteria",
        "comments",
        "pullRequests",
        "attachments",
      ],
      side: ["links"],
    });
    expect(normalizePreviewSectionLayout(null)).toBeUndefined();
    expect(normalizePreviewSectionLayout({ order: [] })).toBeUndefined();
  });

  it("drops a section before/after a target and switches its column", () => {
    const moved = dropPreviewSection(
      DEFAULT_PREVIEW_SECTION_LAYOUT,
      "history",
      "side",
      "comments",
      "before",
    );
    expect(sectionsInColumn(moved, "side")).toEqual(["history", "comments"]);
    expect(sectionsInColumn(moved, "main")).not.toContain("history");

    const back = dropPreviewSection(moved, "comments", "main", "description", "after");
    expect(sectionsInColumn(back, "main").slice(0, 2)).toEqual(["description", "comments"]);
    expect(sectionsInColumn(back, "side")).toEqual(["history"]);
  });

  it("appends to the end of the column when dropped on its empty area", () => {
    const moved = dropPreviewSection(DEFAULT_PREVIEW_SECTION_LAYOUT, "links", "side", null);
    expect(sectionsInColumn(moved, "side")).toEqual(["comments", "links"]);

    const toEmpty = dropPreviewSection(
      { ...DEFAULT_PREVIEW_SECTION_LAYOUT, side: [] },
      "description",
      "side",
      null,
    );
    expect(sectionsInColumn(toEmpty, "side")).toEqual(["description"]);
  });

  it("steps within the column, skipping hidden sections", () => {
    const visible = new Set<PreviewSectionId>(["description", "links", "history", "comments"]);
    const up = stepPreviewSection(DEFAULT_PREVIEW_SECTION_LAYOUT, "history", -1, visible, "main");
    expect(sectionsInColumn(up!, "main").filter((id) => visible.has(id))).toEqual([
      "description",
      "history",
      "links",
    ]);
    expect(
      stepPreviewSection(DEFAULT_PREVIEW_SECTION_LAYOUT, "description", -1, visible, "main"),
    ).toBeNull();
    expect(
      stepPreviewSection(DEFAULT_PREVIEW_SECTION_LAYOUT, "comments", 1, visible, "side"),
    ).toBeNull();
  });

  it("steps across the whole list in the single-column layout", () => {
    const down = stepPreviewSection(
      DEFAULT_PREVIEW_SECTION_LAYOUT,
      "comments",
      1,
      allVisible,
      null,
    );
    expect(down!.order.indexOf("comments")).toBe(down!.order.indexOf("links") + 1);
    expect(down!.side).toEqual(["comments"]);
  });
});
