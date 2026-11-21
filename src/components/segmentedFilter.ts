/**
 * Joined, counted filter buttons in a list pane's tab band (Inbox Priority /
 * Other / All, Agent Work's tabs, Notifications' categories): one look for
 * "narrow this list" across views.
 */
export const SEGMENT_GROUP = "flex shrink-0 items-center overflow-hidden rounded border border-border";

export function segmentClass(active: boolean): string {
  return `whitespace-nowrap border-l border-border px-2 text-2xs leading-4 first:border-l-0 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring ${
    active ? "bg-primary font-semibold text-primary-foreground" : "bg-card text-muted-foreground hover:bg-secondary"
  }`;
}

/** Index after an arrow / Home / End key in a segment group, or null for any other key. */
export function nextSegmentIndex(key: string, index: number, length: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index + length - 1) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}
