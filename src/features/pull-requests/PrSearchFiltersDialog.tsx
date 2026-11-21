import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { listRepositories, listRepoBranches } from "@/lib/azdoCommands";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { FilterField, NativeSelect, filterInputClass } from "@/components/SearchBar";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { isImeComposing } from "@/lib/utils";
import { PR_SEARCH_DATE_BASIS_OPTIONS, PR_SEARCH_STATUS_OPTIONS, type PrSearchDateBasis } from "./PrSearchTypes";
import { PrSearchPersonPicker } from "./PrSearchPersonPicker";
import { initialPrSearchFilters } from "./prSearchState";
import type { PrSearchFilters } from "./prSearchHistoryHelpers";

const BUTTON = "rounded border border-border px-2.5 py-1 text-xs hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring";

export function PrSearchFiltersDialog({ organizationId, azure, filters, anchor, onApply, onClose }: {
  organizationId: string;
  azure: boolean;
  filters: PrSearchFilters;
  anchor: DOMRect;
  onApply: (filters: PrSearchFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [more, setMore] = useState(false);
  const [unresolvedAuthor, setUnresolvedAuthor] = useState(false);
  const [unresolvedReviewer, setUnresolvedReviewer] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { restoreFocus: true });
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>(azure ? '[role="combobox"]' : 'input')?.focus(); }, [azure]);
  const repositories = useQuery({ queryKey: ["prRepositories", organizationId], queryFn: () => listRepositories({ organizationId }), enabled: !!organizationId, staleTime: 5 * 60_000 });
  const allRepositories = repositories.data ?? [];
  const projects = useMemo(() => Array.from(new Map(allRepositories.map((repo) => [repo.projectId, repo.projectName])).entries()).map(([value, label]) => ({ value, label })), [allRepositories]);
  const scopedRepositories = allRepositories.filter((repo) => !draft.projectIds.length || draft.projectIds.includes(repo.projectId));
  const branchQueries = useQueries({ queries: allRepositories.filter((repo) => draft.repositoryIds.includes(repo.repositoryId)).map((repo) => ({
    queryKey: ["prBranchSuggestions", organizationId, repo.projectId, repo.repositoryId],
    queryFn: () => listRepoBranches({ organizationId, project: repo.projectId, repository: repo.repositoryId }),
    enabled: more && !!organizationId, staleTime: 5 * 60_000,
  })) });
  const branches = Array.from(new Set([...draft.targetBranches, ...branchQueries.flatMap((query) => (query.data ?? []).map((branch) => branch.name))]));
  const badDate = !!draft.fromDate && !!draft.toDate && draft.fromDate > draft.toDate;
  const canApply = draft.statuses.length > 0 && !badDate && !unresolvedAuthor && !unresolvedReviewer;
  const update = (patch: Partial<PrSearchFilters>) => setDraft((current) => ({ ...current, ...patch }));
  return createPortal(<div className="fixed inset-0 z-[100]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="PR search filters"
      className="fixed flex max-h-[calc(100vh-2rem)] w-[360px] max-w-[calc(100vw-1rem)] flex-col rounded-md border border-border bg-card shadow-xl"
      style={{ top: Math.min(anchor.bottom + 8, Math.max(8, window.innerHeight - 540)), right: Math.max(8, window.innerWidth - anchor.right) }}
      onKeyDown={(event) => {
        if (isImeComposing(event.nativeEvent)) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type !== "checkbox") {
          event.preventDefault(); event.stopPropagation(); if (canApply) onApply(draft);
        } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) event.stopPropagation();
      }}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2"><h2 className="text-sm font-semibold">Filters</h2><button type="button" aria-label="Close filters" onClick={onClose} className="rounded p-1 hover:bg-secondary"><X className="h-3.5 w-3.5" /></button></div>
      <div className="grid gap-3 overflow-y-auto p-3">
        <fieldset className="grid gap-1.5"><legend className="mb-1 text-xs font-medium text-muted-foreground">Status</legend><div className="flex gap-3">
          {PR_SEARCH_STATUS_OPTIONS.map((option) => <label key={option.value} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.statuses.includes(option.value)} onChange={(event) => update({ statuses: event.target.checked ? [...draft.statuses, option.value] : draft.statuses.filter((status) => status !== option.value) })} />{option.label}</label>)}
        </div></fieldset>
        {azure ? <>
          <PrSearchPersonPicker label="Author" organizationId={organizationId} value={draft.author ?? null} onChange={(author) => update({ author })} onUnresolvedChange={setUnresolvedAuthor} />
          <PrSearchPersonPicker label="Reviewer" organizationId={organizationId} value={draft.reviewer ?? null} onChange={(reviewer) => update({ reviewer })} onUnresolvedChange={setUnresolvedReviewer} />
        </> : null}
        <button type="button" aria-expanded={more} aria-controls="pr-more-filters" onClick={() => setMore((value) => !value)} className="flex items-center gap-1 border-t border-border pt-2 text-left text-xs text-muted-foreground">{more ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}More filters <span className="ml-1 text-2xs">Project, repository, dates…</span></button>
        {more ? <div id="pr-more-filters" className="grid gap-3">
          {repositories.isError ? <p role="alert" className="text-xs text-destructive">Could not load projects and repositories.</p> : null}
          <FilterField label="Project"><MultiSelectFilter options={projects} selected={draft.projectIds} onChange={(projectIds) => {
            const allowed = new Set(allRepositories.filter((repo) => !projectIds.length || projectIds.includes(repo.projectId)).map((repo) => repo.repositoryId));
            update({ projectIds, repositoryIds: draft.repositoryIds.filter((id) => allowed.has(id)), targetBranches: [] });
          }} placeholder="All projects" ariaLabel="Filter by project" searchable disabled={repositories.isLoading} /></FilterField>
          <FilterField label="Repository"><MultiSelectFilter options={scopedRepositories.map((repo) => ({ value: repo.repositoryId, label: repo.repositoryName }))} selected={draft.repositoryIds} onChange={(repositoryIds) => update({ repositoryIds, targetBranches: [] })} placeholder="All repositories" ariaLabel="Filter by repository" searchable disabled={repositories.isLoading} /></FilterField>
          <FilterField label="Target branches"><MultiSelectFilter options={branches.map((branch) => ({ value: branch, label: branch }))} selected={draft.targetBranches} onChange={(targetBranches) => update({ targetBranches })} placeholder="All branches" ariaLabel="Filter by target branch" searchable disabled={!branches.length} /></FilterField>
          {branchQueries.some((query) => query.isError) ? <p role="alert" className="text-xs text-destructive">Some branch suggestions could not be loaded.</p> : null}
          <div className="grid grid-cols-2 gap-2"><FilterField label="From"><input type="date" value={draft.fromDate} max={draft.toDate || undefined} onChange={(event) => update({ fromDate: event.target.value })} className={filterInputClass} /></FilterField><FilterField label="To"><input type="date" value={draft.toDate} min={draft.fromDate || undefined} onChange={(event) => update({ toDate: event.target.value })} className={filterInputClass} /></FilterField></div>
          <FilterField label="Date basis"><NativeSelect value={draft.dateBasis} onChange={(event) => update({ dateBasis: event.target.value as PrSearchDateBasis })}>{PR_SEARCH_DATE_BASIS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect></FilterField>
          {draft.dateBasis === "closed" && draft.statuses.includes("active") ? <p className="text-2xs text-muted-foreground">For active PRs, the date window uses the created date.</p> : null}
          {azure ? <FilterField label="Exclude words"><input value={draft.excludeWords ?? ""} onChange={(event) => update({ excludeWords: event.target.value })} placeholder="Words or quoted phrases, separated by spaces" className={filterInputClass} /></FilterField> : null}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.excludeDrafts} onChange={(event) => update({ excludeDrafts: event.target.checked })} />Hide drafts</label>
        </div> : null}
        {!draft.statuses.length ? <p role="alert" className="text-xs text-destructive">Select at least one status.</p> : null}
        {badDate ? <p role="alert" className="text-xs text-destructive">From must be before or equal to To.</p> : null}
        {unresolvedAuthor || unresolvedReviewer ? <p className="text-2xs text-muted-foreground">Choose a person from the suggestions, or clear the field.</p> : null}
      </div>
      <div className="flex shrink-0 justify-between border-t border-border bg-muted/30 px-3 py-2"><button type="button" className={BUTTON} onClick={() => { setDraft({ ...initialPrSearchFilters(), statuses: ["active", "completed"], sortBy: filters.sortBy }); setUnresolvedAuthor(false); setUnresolvedReviewer(false); }}>Reset</button><button type="button" disabled={!canApply} className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50" onClick={() => onApply(draft)}>Apply &amp; search</button></div>
    </div>
  </div>, document.body);
}
