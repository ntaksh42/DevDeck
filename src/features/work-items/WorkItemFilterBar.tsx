import { useRef } from "react";
import { DockFilterBar, DockFilterInput, useDockFilter } from "@/components/DockFilterBar";
import { focusPrimaryGrid } from "@/lib/utils";

const SMART_FILTER_TITLE =
  "Smart filter: #1234 id, p:1–4 priority, @user assignee, s:active state, t:bug type. Unknown prefixes are searched as text.";

/** The work item grids' smart filter, folded into the grid's dock tab strip. */
export function WorkItemFilterBar({
  value,
  onChange,
  ariaLabel = "Filter",
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filter = useDockFilter(inputRef, focusPrimaryGrid);
  const trimmed = value.trim();

  return (
    <DockFilterBar
      label="Filter work items"
      open={filter.open}
      onOpen={filter.onOpen}
      onClose={filter.onClose}
      inputRef={inputRef}
      hasValue={!!trimmed}
      chips={trimmed ? [{ label: `“${trimmed}”`, onEdit: filter.onOpen, onClear: () => onChange("") }] : []}
    >
      <DockFilterInput
        inputRef={inputRef}
        value={value}
        onChange={onChange}
        placeholder="Filter… #1234, p:1, @user, s:active, t:bug"
        ariaLabel={ariaLabel}
        title={SMART_FILTER_TITLE}
      />
    </DockFilterBar>
  );
}
