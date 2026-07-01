import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type CommitSummary, commandErrorMessage, getCommitParents } from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { LoadingState, ErrorState } from "@/components/StateDisplay";
import { assignCommitGraphLanes, graphLaneCount, type GraphRow } from "./commitGraphLayout";
import { COMMIT_GRID_ROW_HEIGHT } from "./commitSearchConstants";

const LANE_WIDTH = 14;
const LANE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function laneX(lane: number): number {
  return LANE_WIDTH / 2 + lane * LANE_WIDTH;
}

/**
 * Renders one row's lane graphics: the commit's own dot, any straight or
 * merge/branch edges down to its parents, and vertical passthrough lines for
 * branches that are open but not touched by this commit.
 */
function CommitGraphLanes({ row, width }: { row: GraphRow; width: number }) {
  const half = COMMIT_GRID_ROW_HEIGHT / 2;
  return (
    <svg
      width={width}
      height={COMMIT_GRID_ROW_HEIGHT}
      className="shrink-0"
      aria-hidden="true"
    >
      {/* Incoming stub from the row above, in the commit's own lane. */}
      <line
        x1={laneX(row.lane)}
        y1={0}
        x2={laneX(row.lane)}
        y2={half}
        stroke={laneColor(row.lane)}
        strokeWidth={2}
      />
      {row.passthroughLanes.map((lane) => (
        <line
          key={`pass-${lane}`}
          x1={laneX(lane)}
          y1={0}
          x2={laneX(lane)}
          y2={COMMIT_GRID_ROW_HEIGHT}
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      {row.edges.map((edge) =>
        edge.fromLane === edge.toLane ? (
          <line
            key={edge.parentId}
            x1={laneX(edge.fromLane)}
            y1={half}
            x2={laneX(edge.toLane)}
            y2={COMMIT_GRID_ROW_HEIGHT}
            stroke={laneColor(edge.toLane)}
            strokeWidth={2}
          />
        ) : (
          <path
            key={edge.parentId}
            d={`M ${laneX(edge.fromLane)} ${half} C ${laneX(edge.fromLane)} ${COMMIT_GRID_ROW_HEIGHT}, ${laneX(edge.toLane)} ${half}, ${laneX(edge.toLane)} ${COMMIT_GRID_ROW_HEIGHT}`}
            stroke={laneColor(edge.toLane)}
            strokeWidth={2}
            fill="none"
          />
        ),
      )}
      <circle
        cx={laneX(row.lane)}
        cy={half}
        r={4}
        fill={laneColor(row.lane)}
        stroke="var(--card)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export function CommitGraph({
  loading,
  results,
  searched,
}: {
  loading: boolean;
  results: CommitSummary[];
  searched: boolean;
}) {
  const repositoryIds = useMemo(
    () => new Set(results.map((commit) => commit.repositoryId)),
    [results],
  );
  // A DAG only makes sense within one repository — commits from different
  // repositories have no ancestry relationship to each other.
  const singleRepoCommit = repositoryIds.size === 1 ? results[0] : null;
  const commitIds = useMemo(() => results.map((commit) => commit.commitId), [results]);

  const parentsQuery = useQuery({
    queryKey: [
      "commitGraphParents",
      singleRepoCommit?.organizationId,
      singleRepoCommit?.projectId,
      singleRepoCommit?.repositoryId,
      commitIds.join(","),
    ],
    queryFn: () =>
      getCommitParents({
        organizationId: singleRepoCommit!.organizationId,
        projectId: singleRepoCommit!.projectId,
        repositoryId: singleRepoCommit!.repositoryId,
        commitIds,
      }),
    enabled: !!singleRepoCommit && commitIds.length > 0,
  });

  const rows = useMemo(() => {
    if (!parentsQuery.data) return [];
    const parentsById = new Map(parentsQuery.data.map((entry) => [entry.commitId, entry.parentIds]));
    return assignCommitGraphLanes(
      results.map((commit) => ({ id: commit.commitId, parents: parentsById.get(commit.commitId) ?? [] })),
    );
  }, [results, parentsQuery.data]);
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const graphWidth = Math.max(LANE_WIDTH, graphLaneCount(rows) * LANE_WIDTH);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Graph</h2>
        <span className="text-sm text-muted-foreground">
          {loading ? "Searching" : searched ? `${results.length} commits` : "Ready"}
        </span>
      </div>

      {!searched && !loading ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Run a search to load the commit graph.
        </div>
      ) : loading ? (
        <LoadingState />
      ) : results.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">No commits matched.</div>
      ) : !singleRepoCommit ? (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          Select a single repository to view the commit graph — results currently span{" "}
          {repositoryIds.size} repositories.
        </div>
      ) : parentsQuery.isPending ? (
        <LoadingState />
      ) : parentsQuery.isError ? (
        <div className="p-3">
          <ErrorState
            message={commandErrorMessage(parentsQuery.error)}
            onRetry={() => void parentsQuery.refetch()}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
          {results.map((commit) => {
            const row = rowsById.get(commit.commitId);
            const message = commit.comment.split(/\r?\n/, 1)[0] || "(no comment)";
            return (
              <div
                key={commit.commitId}
                className="flex items-center gap-2 border-b border-border px-2 text-sm hover:bg-muted/50"
                style={{ height: COMMIT_GRID_ROW_HEIGHT }}
              >
                {row ? <CommitGraphLanes row={row} width={graphWidth} /> : (
                  <div style={{ width: graphWidth, height: COMMIT_GRID_ROW_HEIGHT }} className="shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => commit.webUrl && openExternalUrl(commit.webUrl)}
                  className="shrink-0 truncate font-mono text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
                  title={commit.commitId}
                >
                  {commit.shortCommitId}
                </button>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={commit.comment}>
                  {message}
                </span>
                <span className="shrink-0 truncate text-xs text-muted-foreground" title={commit.authorName ?? undefined}>
                  {commit.authorName ?? "—"}
                </span>
                <span
                  className="w-20 shrink-0 text-right text-xs text-muted-foreground"
                  title={commit.authorDate ? formatDate(commit.authorDate) : undefined}
                >
                  {commit.authorDate ? formatRelativeDate(commit.authorDate) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
