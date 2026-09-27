import { readStoredJson, storageKey, writeStoredJson } from "@/lib/storage";

// VSCode-style section placement for the work item preview: every collapsible
// section can be reordered and, when comments sit beside the details, moved
// between the details ("main") column and the side column.

export const PREVIEW_SECTION_IDS = [
  "description",
  "acceptanceCriteria",
  "comments",
  "links",
  "pullRequests",
  "attachments",
  "history",
] as const;

export type PreviewSectionId = (typeof PREVIEW_SECTION_IDS)[number];
export type PreviewSectionColumn = "main" | "side";
export type DropPosition = "before" | "after";

export type PreviewSectionLayout = {
  /** Global order; the below-details layout renders it as one list. */
  order: PreviewSectionId[];
  /** Sections placed in the side column when the preview is side-by-side. */
  side: PreviewSectionId[];
};

const STORAGE_KEY = storageKey("azdodeck:wiPreview:sectionLayout", 1);

export const DEFAULT_PREVIEW_SECTION_LAYOUT: PreviewSectionLayout = {
  order: [...PREVIEW_SECTION_IDS],
  side: ["comments"],
};

function isSectionId(value: unknown): value is PreviewSectionId {
  return typeof value === "string" && (PREVIEW_SECTION_IDS as readonly string[]).includes(value);
}

/** Drops unknown/duplicate ids and appends sections added in newer versions. */
export function normalizePreviewSectionLayout(raw: unknown): PreviewSectionLayout | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { order, side } = raw as { order?: unknown; side?: unknown };
  if (!Array.isArray(order) || !Array.isArray(side)) return undefined;
  const nextOrder = [...new Set(order.filter(isSectionId))];
  for (const id of PREVIEW_SECTION_IDS) {
    if (!nextOrder.includes(id)) nextOrder.push(id);
  }
  return { order: nextOrder, side: [...new Set(side.filter(isSectionId))] };
}

export function loadPreviewSectionLayout(): PreviewSectionLayout {
  return readStoredJson(STORAGE_KEY, normalizePreviewSectionLayout, DEFAULT_PREVIEW_SECTION_LAYOUT);
}

export function storePreviewSectionLayout(layout: PreviewSectionLayout) {
  writeStoredJson(STORAGE_KEY, layout);
}

export function sectionColumn(
  layout: PreviewSectionLayout,
  id: PreviewSectionId,
): PreviewSectionColumn {
  return layout.side.includes(id) ? "side" : "main";
}

/** Sections of one column (or all of them when `column` is null), in order. */
export function sectionsInColumn(
  layout: PreviewSectionLayout,
  column: PreviewSectionColumn | null,
): PreviewSectionId[] {
  return column === null
    ? layout.order
    : layout.order.filter((id) => sectionColumn(layout, id) === column);
}

/**
 * Places `id` in `column`, before/after `targetId`, or at the end of the
 * column when there is no target (dropped on the column's empty area).
 */
export function dropPreviewSection(
  layout: PreviewSectionLayout,
  id: PreviewSectionId,
  column: PreviewSectionColumn,
  targetId: PreviewSectionId | null,
  position: DropPosition = "after",
): PreviewSectionLayout {
  if (targetId === id) {
    // Dropped onto itself: only the column can change.
    return withColumn(layout, id, column);
  }
  const without = layout.order.filter((existing) => existing !== id);
  let insertAt: number;
  if (targetId) {
    const targetIndex = without.indexOf(targetId);
    insertAt = position === "before" ? targetIndex : targetIndex + 1;
  } else {
    const columnIds = without.filter((existing) => sectionColumn(layout, existing) === column);
    const last = columnIds[columnIds.length - 1];
    insertAt = last ? without.indexOf(last) + 1 : without.length;
  }
  const order = [...without.slice(0, insertAt), id, ...without.slice(insertAt)];
  return withColumn({ ...layout, order }, id, column);
}

function withColumn(
  layout: PreviewSectionLayout,
  id: PreviewSectionId,
  column: PreviewSectionColumn,
): PreviewSectionLayout {
  const side = layout.side.filter((existing) => existing !== id);
  if (column === "side") side.push(id);
  return { ...layout, side };
}

/**
 * Moves `id` one step up/down among the `visible` sections of the same column
 * (all visible sections when `column` is null, i.e. the single-list layout).
 * Returns null when it is already at that edge.
 */
export function stepPreviewSection(
  layout: PreviewSectionLayout,
  id: PreviewSectionId,
  direction: -1 | 1,
  visible: ReadonlySet<PreviewSectionId>,
  column: PreviewSectionColumn | null,
): PreviewSectionLayout | null {
  const peers = sectionsInColumn(layout, column).filter(
    (existing) => existing === id || visible.has(existing),
  );
  const index = peers.indexOf(id);
  const neighbor = peers[index + direction];
  if (index < 0 || !neighbor) return null;
  return dropPreviewSection(
    layout,
    id,
    sectionColumn(layout, id),
    neighbor,
    direction < 0 ? "before" : "after",
  );
}
