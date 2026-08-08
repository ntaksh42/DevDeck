import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import {
  listCommitRepositories,
  listWorkItemProjects,
} from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { AnalyzeGroupDialog } from "./AnalyzeGroupDialog";
import { AnalyzeGroupList } from "./AnalyzeGroupList";
import type { AnalyzeSelection } from "./AnalyzeSummaryPanel";
import { BranchDetailPanel, QueryDetailPanel } from "./AnalyzeDetailPanels";
import { AnalyzeBreakdownPanel } from "./AnalyzeBreakdownPanel";
import { AnalyzeTrendPanel } from "./AnalyzeTrendPanel";
import { useSharedCursor } from "./AnalyzeCombinedChart";
import { AnalyzeMilestonePanel } from "./AnalyzeMilestonePanel";
import { AnalyzeRangeControls, AnalyzeShortcutHints } from "./AnalyzeRangeControls";
import { branchSeriesColor, querySeriesColor } from "./analyzeColors";
import { groupByBucket } from "./analyzeDateRange";
import { describeRange } from "./analyzeRange";
import {
  downloadAnalyzeGroupsExport,
  readAnalyzeGroupsImportFile,
} from "./analyzeGroupsTransfer";
import {
  createAnalyzeGroupId,
  defaultRangeCount,
  granularityLabel,
  loadAnalyzeGroups,
  MAX_ANALYZE_GROUPS,
  rangeOptions,
  saveAnalyzeGroups,
  type AnalyzeGranularity,
  type AnalyzeGroup,
} from "./analyzeGroupsStorage";
import type { AnalyzeMilestone } from "./analyzeMilestones";
import {
  useAnalyzeBuckets,
  useBranchSeries,
  useBreakdownItems,
  useQuerySeries,
} from "./useAnalyzeQueries";

/** The trend half answers "how did this move"; the breakdown half "who holds what". */
type AnalyzeTab = "trend" | "breakdown";

function emptyGroup(organizationId: string, projectId: string): AnalyzeGroup {
  return {
    id: createAnalyzeGroupId(),
    name: "",
    organizationId,
    projectId,
    queries: [],
    branches: [],
    granularity: "day",
    rangeCount: defaultRangeCount("day"),
    rangePreset: "count",
    rangeFrom: "",
    rangeTo: "",
    breakdownAxis: "assignedTo",
  };
}

export function AnalyzeView() {
  const organizationId = useActiveOrganizationId();
  const [groups, setGroups] = useState<AnalyzeGroup[]>(() => loadAnalyzeGroups());
  const [selectedId, setSelectedId] = useState<string | null>(() => groups[0]?.id ?? null);
  const [selection, setSelection] = useState<AnalyzeSelection | null>(null);
  const [editing, setEditing] = useState<{ group: AnalyzeGroup; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [tab, setTab] = useState<AnalyzeTab>("trend");
  const detailRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => groups.find((group) => group.id === selectedId) ?? null,
    [groups, selectedId],
  );

  const projectsQuery = useQuery({
    queryKey: ["analyzeProjects", organizationId],
    queryFn: () => listWorkItemProjects({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  const repositoriesQuery = useQuery({
    queryKey: ["analyzeRepositories", organizationId],
    queryFn: () => listCommitRepositories({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  const buckets = useAnalyzeBuckets(selected);
  const querySeries = useQuerySeries(selected, buckets, !!organizationId);
  const branchSeries = useBranchSeries(selected, buckets, !!organizationId);
  const [cursor, setCursor] = useSharedCursor(buckets.length);
  // Only fetched while the tab is open: it pulls whole rows, not counts.
  const breakdown = useBreakdownItems(
    selected,
    !!organizationId && tab === "breakdown" && !selection,
  );

  const persist = useCallback((next: AnalyzeGroup[]) => {
    setGroups(next);
    saveAnalyzeGroups(next);
  }, []);

  // Selecting a different group leaves any drilled-in member behind.
  useEffect(() => {
    setSelection(null);
    setHidden(new Set());
  }, [selectedId]);

  function openAdd() {
    if (groups.length >= MAX_ANALYZE_GROUPS) {
      setError(`グループは ${MAX_ANALYZE_GROUPS} 件までです。`);
      return;
    }
    setError(null);
    setEditing({
      group: emptyGroup(organizationId, projectsQuery.data?.[0]?.projectId ?? ""),
      isNew: true,
    });
  }

  function openEdit(groupId: string) {
    const group = groups.find((entry) => entry.id === groupId);
    if (group) setEditing({ group, isNew: false });
  }

  function removeGroup(groupId: string) {
    const next = groups.filter((group) => group.id !== groupId);
    persist(next);
    if (selectedId === groupId) setSelectedId(next[0]?.id ?? null);
  }

  function saveGroup(group: AnalyzeGroup) {
    const exists = groups.some((entry) => entry.id === group.id);
    const next = exists
      ? groups.map((entry) => (entry.id === group.id ? group : entry))
      : [...groups, group];
    persist(next);
    setSelectedId(group.id);
    setEditing(null);
  }

  function updateSelected(patch: Partial<AnalyzeGroup>) {
    if (!selected) return;
    persist(groups.map((group) => (group.id === selected.id ? { ...group, ...patch } : group)));
  }

  function setGranularity(granularity: AnalyzeGranularity) {
    // Day, week and month ranges are different units, so reset to the matching
    // default instead of reading "30" as thirty weeks.
    updateSelected({ granularity, rangeCount: defaultRangeCount(granularity) });
  }

  /** Widens or narrows the counted window without leaving the keyboard. */
  function stepRange(direction: 1 | -1) {
    if (!selected || selected.rangePreset !== "count") return;
    const options = rangeOptions(selected.granularity);
    const index = options.indexOf(selected.rangeCount as (typeof options)[number]);
    const next = options[Math.min(options.length - 1, Math.max(0, index + direction))];
    if (next !== undefined && next !== selected.rangeCount) updateSelected({ rangeCount: next });
  }

  function setMilestones(memberId: string, milestones: AnalyzeMilestone[]) {
    if (!selected) return;
    updateSelected({
      queries: selected.queries.map((member) =>
        member.id === memberId ? { ...member, milestones } : member,
      ),
    });
  }

  function toggleSeries(memberId: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function exportGroups() {
    setStatus(downloadAnalyzeGroupsExport(groups));
  }

  async function importGroups(file: File) {
    const result = await readAnalyzeGroupsImportFile(file);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    const next = [...groups, ...result.groups].slice(0, MAX_ANALYZE_GROUPS);
    persist(next);
    setSelectedId(result.groups[0]?.id ?? selectedId);
    setError(null);
    setStatus(result.message);
  }

  const activeQuery = selection?.kind === "query"
    ? querySeries.find((series) => series.memberId === selection.memberId)
    : undefined;
  const activeBranch = selection?.kind === "branch"
    ? branchSeries.find((series) => series.memberId === selection.memberId)
    : undefined;

  // The chart draws whichever members the legend has left visible.
  const chartLines = querySeries
    .map((series, index) => ({
      memberId: series.memberId,
      name: series.name,
      color: querySeriesColor(index),
      values: series.points.map((point) => point.count),
      milestones: series.milestones,
    }))
    .filter((series) => !hidden.has(series.memberId));

  const chartBars = branchSeries
    .map((series, index) => {
      const grouped = groupByBucket(series.commits, buckets, (commit) => commit.authorDate);
      return {
        memberId: series.memberId,
        name: series.name,
        color: branchSeriesColor(index),
        counts: buckets.map((bucket) => grouped.get(bucket.key)?.length ?? 0),
      };
    })
    .filter((series) => !hidden.has(series.memberId));

  const legendEntries = [
    ...querySeries.map((series, index) => ({
      memberId: series.memberId,
      name: series.name,
      color: querySeriesColor(index),
      values: series.points.map((point) => point.count),
      kind: "query" as const,
      milestones: series.milestones,
    })),
    ...branchSeries.map((series, index) => {
      const grouped = groupByBucket(series.commits, buckets, (commit) => commit.authorDate);
      return {
        memberId: series.memberId,
        name: series.name,
        color: branchSeriesColor(index),
        values: buckets.map(
          (bucket) => (grouped.get(bucket.key)?.length ?? 0) as number | null,
        ),
        kind: "branch" as const,
        milestones: [] as AnalyzeMilestone[],
      };
    }),
  ];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr] overflow-hidden">
      <AnalyzeGroupList
        groups={groups}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpen={() => detailRef.current?.focus()}
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={removeGroup}
        onExport={exportGroups}
        onImport={importGroups}
      />

      <div className="flex min-h-0 flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            {groups.length === 0
              ? "グループを追加すると、クエリの推移とブランチのコミットをまとめて確認できます。"
              : "グループを選択してください。"}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="truncate text-base font-semibold">
                  {selection && (activeQuery || activeBranch) ? (
                    <>
                      <span className="font-medium text-muted-foreground">{selected.name} › </span>
                      {activeQuery?.name ?? activeBranch?.name}
                    </>
                  ) : (
                    selected.name
                  )}
                </h2>
                <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5">
                    クエリ {selected.queries.length}
                  </span>
                  <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5">
                    ブランチ {selected.branches.length}
                  </span>
                  <span className="tabular-nums">
                    {describeRange(selected, granularityLabel(selected.granularity))}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selection && (
                  <button
                    type="button"
                    onClick={() => setSelection(null)}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                    一覧へ
                  </button>
                )}
                <AnalyzeRangeControls
                  group={selected}
                  onGranularityChange={setGranularity}
                  onPatch={updateSelected}
                />
                <button
                  type="button"
                  aria-label="グループを編集"
                  onClick={() => openEdit(selected.id)}
                  className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="グループを削除"
                  onClick={() => removeGroup(selected.id)}
                  className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <AnalyzeShortcutHints hasSelection={!!selection} />

            <div
              ref={detailRef}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape" && selection) {
                  event.stopPropagation();
                  setSelection(null);
                  return;
                }
                if (event.key === "d" || event.key === "D") setGranularity("day");
                if (event.key === "w" || event.key === "W") setGranularity("week");
                if (event.key === "m" || event.key === "M") setGranularity("month");
                if (event.key === "]") stepRange(1);
                if (event.key === "[") stepRange(-1);
              }}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4 focus:outline-none"
            >
              {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
              {status && <p className="mb-3 text-xs text-muted-foreground">{status}</p>}

              {activeQuery ? (
                <div className="flex flex-col gap-4">
                  <AnalyzeMilestonePanel
                    series={activeQuery}
                    buckets={buckets}
                    onChange={(milestones) => setMilestones(activeQuery.memberId, milestones)}
                  />
                  <QueryDetailPanel
                    series={activeQuery}
                    buckets={buckets}
                    granularity={selected.granularity}
                  />
                </div>
              ) : activeBranch ? (
                <BranchDetailPanel
                  series={activeBranch}
                  buckets={buckets}
                  granularity={selected.granularity}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <div
                    className="flex w-fit overflow-hidden rounded-md border border-border"
                    role="tablist"
                    aria-label="表示"
                  >
                    {(
                      [
                        ["trend", "推移"],
                        ["breakdown", "内訳"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={tab === value}
                        onClick={() => setTab(value)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          // Arrows move between tabs, as a tablist is expected to.
                          event.preventDefault();
                          event.stopPropagation();
                          setTab(value === "trend" ? "breakdown" : "trend");
                        }}
                        className={`px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                          tab === value
                            ? "bg-secondary font-semibold"
                            : "bg-card text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {tab === "breakdown" ? (
                    <AnalyzeBreakdownPanel
                      items={breakdown.items}
                      truncated={breakdown.truncated}
                      isFetching={breakdown.isFetching}
                      isError={breakdown.isError}
                      error={breakdown.error}
                      hasQueries={selected.queries.length > 0}
                      axis={selected.breakdownAxis}
                      onAxisChange={(breakdownAxis) => updateSelected({ breakdownAxis })}
                    />
                  ) : (
                    <AnalyzeTrendPanel
                      buckets={buckets}
                      granularity={selected.granularity}
                      querySeries={querySeries}
                      branchSeries={branchSeries}
                      lines={chartLines}
                      bars={chartBars}
                      legendEntries={legendEntries}
                      hidden={hidden}
                      onToggleSeries={toggleSeries}
                      cursor={cursor}
                      onCursorChange={setCursor}
                      onOpen={setSelection}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {editing && (
        <AnalyzeGroupDialog
          group={editing.group}
          isNew={editing.isNew}
          projects={projectsQuery.data ?? []}
          repositories={repositoriesQuery.data ?? []}
          onSave={saveGroup}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
