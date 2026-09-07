// "Who holds what, right now" — a snapshot breakdown rather than a trend.
//
// The rest of the Analyze view answers "how did this move over time". This
// answers a different question on the same data: how the items a group's
// queries return are split across a field today. There is no time axis, so it
// reads the current query result rather than sampling history.

import type { WorkItemSummary } from "@/lib/azdoCommands";

/**
 * Fields a breakdown can group by. Only `assignedTo` is exposed in the UI
 * today; the others exist so adding one is a list entry rather than a rewrite.
 */
export type BreakdownAxis = "assignedTo" | "state" | "workItemType";

export const BREAKDOWN_AXIS_LABELS: Record<BreakdownAxis, string> = {
  assignedTo: "担当者",
  state: "状態",
  workItemType: "種別",
};

/** Shown for items the axis has no value for, e.g. nobody is assigned. */
export const UNASSIGNED_LABEL = "未割当";

/** Beyond this the chart stops being readable; the tail is folded together. */
export const MAX_BREAKDOWN_SLICES = 12;

export type BreakdownSlice = {
  /** Display name, or `UNASSIGNED_LABEL` when the field was empty. */
  key: string;
  count: number;
  /** 0-1 of the total, for the bar width. */
  ratio: number;
  /** True for the folded "その他" row, which cannot be drilled into. */
  isOther: boolean;
};

export type Breakdown = {
  axis: BreakdownAxis;
  slices: BreakdownSlice[];
  total: number;
  /** Distinct values before folding, so the UI can say what was collapsed. */
  distinctCount: number;
};

function axisValue(item: WorkItemSummary, axis: BreakdownAxis): string | null {
  switch (axis) {
    case "assignedTo":
      return item.assignedTo;
    case "state":
      return item.state;
    case "workItemType":
      return item.workItemType;
  }
}

/**
 * Azure DevOps returns display names, which arrive with inconsistent spacing
 * and occasionally as `Name <email>`. Normalising here keeps one person from
 * showing up as two bars.
 */
export function normalizeAxisValue(value: string | null | undefined): string {
  if (!value) return UNASSIGNED_LABEL;
  const withoutEmail = value.replace(/\s*<[^>]*>\s*$/, "");
  const collapsed = withoutEmail.replace(/\s+/g, " ").trim();
  return collapsed || UNASSIGNED_LABEL;
}

/**
 * Counts items per axis value, largest first.
 *
 * Ties break by name so the order is stable between refreshes rather than
 * following whatever order the API happened to return.
 */
export function buildBreakdown(
  items: WorkItemSummary[],
  axis: BreakdownAxis,
  maxSlices = MAX_BREAKDOWN_SLICES,
): Breakdown {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = normalizeAxisValue(axisValue(item, axis));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = items.length;
  const distinctCount = counts.size;
  const ordered = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const toSlice = (key: string, count: number, isOther: boolean): BreakdownSlice => ({
    key,
    count,
    ratio: total > 0 ? count / total : 0,
    isOther,
  });

  // Folding is only worth it when it actually shortens the list: collapsing a
  // single row into "その他" would hide a name for nothing.
  if (maxSlices > 0 && ordered.length > maxSlices + 1) {
    const head = ordered.slice(0, maxSlices);
    const tail = ordered.slice(maxSlices);
    const tailTotal = tail.reduce((sum, [, count]) => sum + count, 0);
    return {
      axis,
      total,
      distinctCount,
      slices: [
        ...head.map(([key, count]) => toSlice(key, count, false)),
        toSlice(`その他 ${tail.length} 件`, tailTotal, true),
      ],
    };
  }

  return {
    axis,
    total,
    distinctCount,
    slices: ordered.map(([key, count]) => toSlice(key, count, false)),
  };
}

/**
 * Merges the results of several queries.
 *
 * A work item can be returned by more than one query in a group, and counting
 * it twice would make the totals disagree with the trend view. Identity is the
 * organization/project/id triple, since ids are only unique within a project.
 */
export function mergeQueryResults(results: (WorkItemSummary[] | undefined)[]): WorkItemSummary[] {
  const seen = new Set<string>();
  const merged: WorkItemSummary[] = [];
  for (const result of results) {
    if (!result) continue;
    for (const item of result) {
      const identity = `${item.organizationId}/${item.projectId}/${item.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push(item);
    }
  }
  return merged;
}
