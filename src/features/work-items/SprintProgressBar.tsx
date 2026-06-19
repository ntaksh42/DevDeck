import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSprintProgress, type SprintProgress } from "@/lib/azdoCommands";
import { workItemQueryKeys } from "./queryKeys";

function daysRemaining(finishDate: string | null): number | null {
  if (!finishDate) return null;
  const finish = new Date(finishDate);
  if (Number.isNaN(finish.getTime())) return null;
  const today = new Date();
  const startOfDay = (date: Date) =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const diffMs = startOfDay(finish) - startOfDay(today);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function urgencyClasses(days: number | null): string {
  if (days === null) return "text-muted-foreground";
  if (days <= 1) return "text-red-600 dark:text-red-400 font-medium";
  if (days <= 3) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-muted-foreground";
}

function progressBarColor(days: number | null): string {
  if (days !== null && days <= 1) return "bg-red-500";
  if (days !== null && days <= 3) return "bg-amber-500";
  return "bg-primary";
}

/**
 * Compact current-sprint summary for the work item headers. Renders nothing
 * when the backend cannot resolve a current sprint (no team, no active
 * iteration, or fetch failure), per the issue's "hide, don't error" rule.
 *
 * Clicking toggles a caller-owned "this iteration only" filter, scoped by the
 * iteration's work item ids.
 */
export function SprintProgressBar({
  organizationId,
  projectId,
  active,
  onToggle,
}: {
  organizationId: string;
  projectId: string | null;
  active: boolean;
  onToggle: (progress: SprintProgress) => void;
}) {
  const query = useQuery({
    queryKey: workItemQueryKeys.sprintProgress(organizationId, projectId ?? ""),
    queryFn: () =>
      getSprintProgress({ organizationId, projectId: projectId ?? "" }),
    enabled: !!organizationId && !!projectId,
    staleTime: 60 * 60_000,
    retry: false,
  });

  const progress = query.data ?? null;
  const days = useMemo(
    () => daysRemaining(progress?.finishDate ?? null),
    [progress?.finishDate],
  );

  if (!progress) return null;

  const { totalCount, completedCount, totalPoints, completedPoints } = progress;
  const ratio = totalCount > 0 ? completedCount / totalCount : 0;
  const daysLabel =
    days === null
      ? "—"
      : days < 0
        ? "overdue"
        : days === 0
          ? "last day"
          : `${days}d left`;

  return (
    <button
      type="button"
      onClick={() => onToggle(progress)}
      aria-pressed={active}
      title={`${progress.iterationName} — click to ${active ? "clear" : "show only this iteration"}`}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-md border px-2 text-xs outline-none focus:ring-2 focus:ring-ring ${
        active
          ? "border-primary bg-primary/10"
          : "border-input bg-background hover:bg-accent"
      }`}
    >
      <span className="font-medium text-foreground">{progress.iterationName}</span>
      <span className={urgencyClasses(days)}>{daysLabel}</span>
      <span
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <span
          className={`block h-full rounded-full ${progressBarColor(days)}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className="text-muted-foreground">
        {completedCount}/{totalCount}
        {totalPoints !== null
          ? ` · ${completedPoints ?? 0}/${totalPoints} pt`
          : ""}
      </span>
    </button>
  );
}
