import { ChevronDown, X } from "lucide-react";
import { PR_SEARCH_STATUS_OPTIONS } from "./PrSearchTypes";
import type { PrSearchFilters } from "./prSearchHistoryHelpers";

const CHIP = "inline-flex items-center gap-1 rounded border border-border bg-card/60 px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-secondary";

export function PrSearchFilterChips({ filters, onOpen, onChange }: {
  filters: PrSearchFilters;
  onOpen: (owner: HTMLButtonElement) => void;
  onChange: (next: PrSearchFilters) => void;
}) {
  const chips: { key: string; label: string; remove: Partial<PrSearchFilters> }[] = [];
  if (filters.author) chips.push({ key: "author", label: `Author: ${filters.author.displayName}`, remove: { author: null } });
  if (filters.reviewer) chips.push({ key: "reviewer", label: `Reviewer: ${filters.reviewer.displayName}`, remove: { reviewer: null } });
  if (filters.projectIds.length) chips.push({ key: "projects", label: `${filters.projectIds.length} project(s)`, remove: { projectIds: [], repositoryIds: [], targetBranches: [] } });
  if (filters.repositoryIds.length) chips.push({ key: "repositories", label: `${filters.repositoryIds.length} repository(s)`, remove: { repositoryIds: [], targetBranches: [] } });
  if (filters.targetBranches.length) chips.push({ key: "branches", label: filters.targetBranches.join(", "), remove: { targetBranches: [] } });
  if (filters.fromDate || filters.toDate) chips.push({ key: "dates", label: `${filters.fromDate || "…"} — ${filters.toDate || "…"}`, remove: { fromDate: "", toDate: "" } });
  if (filters.excludeWords) chips.push({ key: "exclude words", label: `Exclude: ${filters.excludeWords}`, remove: { excludeWords: "" } });
  if (filters.excludeDrafts) chips.push({ key: "drafts", label: "No drafts", remove: { excludeDrafts: false } });
  return <div className="flex min-h-5 flex-wrap items-center gap-1.5">
    <button type="button" className={CHIP} aria-label="Change status filter" onClick={(event) => onOpen(event.currentTarget)}>
      {filters.statuses.map((status) => PR_SEARCH_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status).join(" + ")}
      <ChevronDown className="h-3 w-3" aria-hidden="true" />
    </button>
    {chips.map((chip) => <button type="button" key={chip.key} className={CHIP} aria-label={`Remove ${chip.key} filter`} onClick={() => onChange({ ...filters, ...chip.remove })}>{chip.label}<X className="h-2.5 w-2.5" aria-hidden="true" /></button>)}
  </div>;
}
