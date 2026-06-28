// Azure DevOps standard work item type colors, keyed by lowercase type name.
const WORK_ITEM_TYPE_COLORS: Record<string, string> = {
  bug: "#CC293D",
  task: "#F2CB1D",
  "user story": "#009CCC",
  "product backlog item": "#009CCC",
  requirement: "#009CCC",
  feature: "#773B93",
  epic: "#FF7B00",
  issue: "#B4009E",
  impediment: "#B4009E",
  "test case": "#004B50",
};

export function workItemTypeColor(workItemType: string): string {
  return WORK_ITEM_TYPE_COLORS[workItemType.trim().toLowerCase()] ?? "#64748B";
}

export function workItemStateDotClass(state: string): string {
  const normalized = state.trim().toLowerCase();
  if (["done", "closed", "completed", "inactive"].includes(normalized)) {
    return "bg-green-500";
  }
  if (normalized === "resolved") return "bg-amber-500";
  if (
    ["active", "in progress", "doing", "committed", "open"].includes(normalized)
  ) {
    return "bg-blue-500";
  }
  if (normalized === "removed") return "bg-slate-300";
  // New / To Do / Proposed / Approved and unknown custom states.
  return "bg-slate-400";
}

export function WorkItemTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded border border-border bg-card px-1.5 text-[11px] font-medium leading-[18px] text-foreground">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: workItemTypeColor(type) }}
      />
      <span className="truncate">{type}</span>
    </span>
  );
}

export function WorkItemStatePill({ state }: { state: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-card px-1.5 text-[11px] leading-[18px] text-foreground">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${workItemStateDotClass(state)}`}
      />
      <span className="truncate">{state}</span>
    </span>
  );
}
