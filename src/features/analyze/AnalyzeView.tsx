import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { listWorkItemProjects } from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { AnalyzeGroupDialog } from "./AnalyzeGroupDialog";
import { AnalyzeGroupList } from "./AnalyzeGroupList";
import { AnalyzeSummaryPanel, type AnalyzeSelection } from "./AnalyzeSummaryPanel";
import { QueryDetailPanel } from "./AnalyzeDetailPanels";
import {
  bucketRangeEnd,
  bucketRangeStart,
} from "./analyzeDateRange";
import {
  createAnalyzeGroupId,
  defaultRangeCount,
  loadAnalyzeGroups,
  MAX_ANALYZE_GROUPS,
  rangeOptions,
  saveAnalyzeGroups,
  type AnalyzeGranularity,
  type AnalyzeGroup,
} from "./analyzeGroupsStorage";
import { useAnalyzeBuckets, useQuerySeries } from "./useAnalyzeQueries";

function emptyGroup(organizationId: string, projectId: string): AnalyzeGroup {
  return {
    id: createAnalyzeGroupId(),
    name: "",
    organizationId,
    projectId,
    queries: [],
    granularity: "day",
    rangeCount: defaultRangeCount("day"),
  };
}

export function AnalyzeView() {
  const organizationId = useActiveOrganizationId();
  const [groups, setGroups] = useState<AnalyzeGroup[]>(() => loadAnalyzeGroups());
  const [selectedId, setSelectedId] = useState<string | null>(() => groups[0]?.id ?? null);
  const [selection, setSelection] = useState<AnalyzeSelection | null>(null);
  const [editing, setEditing] = useState<{ group: AnalyzeGroup; isNew: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const buckets = useAnalyzeBuckets(selected);
  const querySeries = useQuerySeries(selected, buckets, !!organizationId);

  const persist = useCallback((next: AnalyzeGroup[]) => {
    setGroups(next);
    saveAnalyzeGroups(next);
  }, []);

  // Selecting a different group leaves any drilled-in member behind.
  useEffect(() => {
    setSelection(null);
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
    // Day and week ranges are different units, so reset to the matching default
    // instead of reading "30" as thirty weeks.
    updateSelected({ granularity, rangeCount: defaultRangeCount(granularity) });
  }

  const activeQuery = selection?.kind === "query"
    ? querySeries.find((series) => series.memberId === selection.memberId)
    : undefined;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr] gap-3 overflow-hidden">
      <AnalyzeGroupList
        groups={groups}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpen={() => detailRef.current?.focus()}
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={removeGroup}
      />

      <div className="flex min-h-0 flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            {groups.length === 0
              ? "グループを追加すると、クエリの推移をまとめて確認できます。"
              : "グループを選択してください。"}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="truncate text-base font-semibold">
                  {selection && activeQuery ? (
                    <>
                      <span className="font-medium text-muted-foreground">{selected.name} › </span>
                      {activeQuery.name}
                    </>
                  ) : (
                    selected.name
                  )}
                </h2>
                <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5">
                    クエリ {selected.queries.length}
                  </span>
                  {buckets.length > 0 && (
                    <span className="tabular-nums">
                      {bucketRangeStart(buckets)} – {bucketRangeEnd(buckets)}
                    </span>
                  )}
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
                <div
                  className="flex overflow-hidden rounded-md border border-border"
                  role="group"
                  aria-label="粒度"
                >
                  {(["day", "week"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected.granularity === value}
                      onClick={() => setGranularity(value)}
                      className={`px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        selected.granularity === value
                          ? "bg-secondary font-semibold"
                          : "bg-card text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {value === "day" ? "Day" : "Week"}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="期間"
                  value={selected.rangeCount}
                  onChange={(event) => updateSelected({ rangeCount: Number(event.target.value) })}
                  className="rounded-md border border-border bg-card px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {rangeOptions(selected.granularity).map((option) => (
                    <option key={option} value={option}>
                      直近 {option} {selected.granularity === "day" ? "日" : "週"}
                    </option>
                  ))}
                </select>
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
              }}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4 focus:outline-none"
            >
              {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
              {activeQuery ? (
                <QueryDetailPanel
                  series={activeQuery}
                  buckets={buckets}
                  granularity={selected.granularity}
                />
              ) : (
                <AnalyzeSummaryPanel
                  querySeries={querySeries}
                  onOpen={setSelection}
                />
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
          onSave={saveGroup}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
