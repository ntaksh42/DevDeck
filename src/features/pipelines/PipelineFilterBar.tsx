import { useRef } from "react";
import { DockFilterBar, DockFilterInput, useDockFilter } from "@/components/DockFilterBar";
import { focusPrimaryGrid } from "@/lib/utils";
import type { PipelineRunFilters } from "./pipelineBoard";

const RESULT_OPTIONS = [
  { value: "", label: "All results" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
  { value: "partiallySucceeded", label: "Partially succeeded" },
];

/** Run-history filters (branch / result / my runs), folded into the board's dock tab strip. */
export function PipelineFilterBar({
  filters,
  onChange,
}: {
  filters: PipelineRunFilters;
  onChange: (filters: PipelineRunFilters) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filter = useDockFilter(inputRef, focusPrimaryGrid);
  const branch = filters.branch.trim();
  const resultLabel = RESULT_OPTIONS.find((option) => option.value === filters.result)?.label;

  const chips = [
    ...(branch
      ? [{ label: `branch: ${branch}`, onEdit: filter.onOpen, onClear: () => onChange({ ...filters, branch: "" }) }]
      : []),
    ...(filters.result
      ? [
          {
            label: `result: ${resultLabel ?? filters.result}`,
            onEdit: filter.onOpen,
            onClear: () => onChange({ ...filters, result: "" }),
          },
        ]
      : []),
    ...(filters.requestedForMe
      ? [{ label: "My runs", onEdit: filter.onOpen, onClear: () => onChange({ ...filters, requestedForMe: false }) }]
      : []),
  ];

  return (
    <DockFilterBar
      label="Filter runs"
      open={filter.open}
      onOpen={filter.onOpen}
      onClose={filter.onClose}
      inputRef={inputRef}
      hasValue={chips.length > 0}
      chips={chips}
    >
      <DockFilterInput
        inputRef={inputRef}
        value={filters.branch}
        onChange={(value) => onChange({ ...filters, branch: value })}
        placeholder="Branch…"
        ariaLabel="Filter runs by branch"
      />
      <select
        value={filters.result}
        onChange={(event) => onChange({ ...filters, result: event.target.value })}
        aria-label="Filter runs by result"
        className="h-[18px] rounded-md border border-input bg-background px-1 text-xs outline-none focus:ring-2 focus:ring-ring"
      >
        {RESULT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={filters.requestedForMe}
          onChange={(event) => onChange({ ...filters, requestedForMe: event.target.checked })}
          className="h-3 w-3"
        />
        My runs
      </label>
    </DockFilterBar>
  );
}
