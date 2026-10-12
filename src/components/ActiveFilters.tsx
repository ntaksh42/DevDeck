import { focusPrimaryGrid } from "@/lib/utils";

type ActiveFiltersProps = {
  count: number;
  onClear: () => void;
  shownCount?: number;
};

/**
 * Shared status-bar indicator for grids: shows how many filters are active
 * (text/tab/column each count as one) and a unified "Clear filters" button.
 * Renders nothing when no filter is active, so the button unmounts as it is
 * used; focus then moves to the grid instead of falling to <body>.
 */
export function ActiveFilters({ count, onClear, shownCount }: ActiveFiltersProps) {
  if (count <= 0) return null;
  return (
    <>
      <span>
        {count} filter{count === 1 ? "" : "s"} active
      </span>
      {shownCount !== undefined ? <span>{shownCount} shown</span> : null}
      <button
        type="button"
        onClick={() => {
          onClear();
          window.setTimeout(focusPrimaryGrid, 0);
        }}
        className="rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
      >
        Clear filters
      </button>
    </>
  );
}
