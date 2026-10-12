// What the Analyze view currently shows for a group, kept for the Agent panel.
// The view stores it as it renders so the context document uses the numbers
// on screen instead of refetching them.

export type AnalyzeGroupContextQuery = {
  name: string;
  wiql: string;
  /** One value per period, oldest first; `null` where Azure DevOps could not answer. */
  values: (number | null)[];
  /** Why the series could not be loaded, if it failed. */
  error: string | null;
};

export type AnalyzeGroupContext = {
  granularity: "day" | "week";
  rangeCount: number;
  /** Period labels, oldest first, matching each query's `values`. */
  periods: string[];
  queries: AnalyzeGroupContextQuery[];
};

const contexts = new Map<string, AnalyzeGroupContext>();

export function setAnalyzeGroupContext(groupId: string, context: AnalyzeGroupContext): void {
  contexts.set(groupId, context);
}

export function getAnalyzeGroupContext(groupId: string): AnalyzeGroupContext | undefined {
  return contexts.get(groupId);
}
