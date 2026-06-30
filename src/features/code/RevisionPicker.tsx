import { type RevisionType } from "@/lib/azdoCommands";
import { FilterableSelect, type SelectOption } from "@/features/pipelines/FilterableSelect";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const INPUT_CLASS =
  "h-9 w-40 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

// Picks one side (base or target) of a Compare revision: a branch, a tag, or
// a free-typed commit SHA. Used twice by `CodeCompareView` (base and target).
export function RevisionPicker({
  label,
  type,
  value,
  branchOptions,
  tagOptions,
  onTypeChange,
  onValueChange,
}: {
  label: string;
  type: RevisionType;
  value: string;
  branchOptions: SelectOption[];
  tagOptions: SelectOption[];
  onTypeChange: (type: RevisionType) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={type}
        onChange={(event) => onTypeChange(event.target.value as RevisionType)}
        aria-label={`${label} revision type`}
        className={SELECT_CLASS}
      >
        <option value="branch">Branch</option>
        <option value="tag">Tag</option>
        <option value="commit">Commit</option>
      </select>
      {type === "commit" ? (
        <input
          type="text"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="Commit SHA"
          aria-label={`${label} commit SHA`}
          className={INPUT_CLASS}
        />
      ) : (
        <div className="w-48">
          <FilterableSelect
            value={value}
            options={type === "branch" ? branchOptions : tagOptions}
            onChange={onValueChange}
            placeholder={type === "branch" ? "Select a branch" : "Select a tag"}
            ariaLabel={`${label} ${type}`}
          />
        </div>
      )}
    </div>
  );
}
