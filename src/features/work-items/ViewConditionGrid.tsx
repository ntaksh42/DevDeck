import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { WorkItemFieldOption } from '@/lib/azdoCommands';
import {
  KNOWN_FIELD_TYPES,
  operatorsForFieldType,
  parseWiqlConditions,
  replaceWiqlConditions,
  type WiqlCondition,
} from './wiqlConditions';

export const CONDITION_GRID_FOCUS_ID = "view-condition-grid-focus";

const NEW_CONDITION: WiqlCondition = {
  conjunction: "AND",
  field: "System.Title",
  operator: "CONTAINS",
  value: "",
};

const inputClass =
  "h-7 min-w-0 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring";

// The grid is rebuilt from the WIQL on every edit, so a text box keeps what the
// user is typing while focused (a trailing ", " in a list would otherwise vanish
// on re-serialization) and shows the parsed value again on blur.
function DraftInput({
  value,
  onCommit,
  ...props
}: { value: string; onCommit: (value: string) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const [local, setLocal] = useState<string | null>(null);
  return (
    <input
      {...props}
      value={local ?? value}
      onChange={(event) => {
        setLocal(event.target.value);
        onCommit(event.target.value);
      }}
      onBlur={() => setLocal(null)}
      className={inputClass}
    />
  );
}

const fieldInputId = (index: number) =>
  index === 0 ? CONDITION_GRID_FOCUS_ID : `view-condition-field-${index}`;

function focusLater(id: string) {
  window.setTimeout(() => document.getElementById(id)?.focus(), 0);
}

export function ViewConditionGrid({
  wiql,
  onWiqlChange,
  fields,
  hasProject,
}: {
  wiql: string;
  onWiqlChange: (value: string) => void;
  fields: WorkItemFieldOption[];
  hasProject: boolean;
}) {
  const parsed = useMemo(() => parseWiqlConditions(wiql), [wiql]);
  const fieldTypes = useMemo(() => {
    const types: Record<string, string> = { ...KNOWN_FIELD_TYPES };
    for (const field of fields) types[field.referenceName] = field.fieldType;
    return types;
  }, [fields]);
  const fieldOptions = useMemo(() => {
    const names = new Map(fields.map((field) => [field.referenceName, field.name]));
    for (const referenceName of Object.keys(KNOWN_FIELD_TYPES)) {
      if (!names.has(referenceName)) names.set(referenceName, referenceName.split(".").pop() ?? referenceName);
    }
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [fields]);

  if (!parsed.ok) {
    return (
      <div id={CONDITION_GRID_FOCUS_ID} tabIndex={-1} role="note" className="rounded-md border border-border bg-muted px-2.5 py-2 text-xs text-muted-foreground outline-none">
        This WIQL can&apos;t be shown as conditions: {parsed.reason} Edit it in the WIQL box below.
      </div>
    );
  }
  const conditions = parsed.conditions;

  function write(next: WiqlCondition[]) {
    onWiqlChange(replaceWiqlConditions(wiql, next, fieldTypes));
  }
  function update(index: number, patch: Partial<WiqlCondition>) {
    write(conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)));
  }
  function remove(index: number) {
    write(conditions.filter((_, i) => i !== index));
    const next = conditions.length - 1;
    focusLater(next === 0 ? CONDITION_GRID_FOCUS_ID : fieldInputId(Math.min(index, next - 1)));
  }
  function add() {
    write([...conditions, NEW_CONDITION]);
    focusLater(fieldInputId(conditions.length));
  }

  return (
    <div className="grid gap-1" role="group" aria-label="Conditions">
      <datalist id="view-condition-fields">
        {fieldOptions.map(([referenceName, name]) => (
          <option key={referenceName} value={referenceName}>{name}</option>
        ))}
      </datalist>
      {conditions.length > 0 ? (
        <div className="grid grid-cols-[4rem_minmax(0,1.4fr)_8.5rem_minmax(0,1fr)_1.5rem] items-center gap-1 text-2xs text-muted-foreground">
          <span>And/Or</span>
          <span>Field</span>
          <span>Operator</span>
          <span>Value</span>
          <span />
        </div>
      ) : null}
      {conditions.map((condition, index) => {
        const label = `condition ${index + 1}`;
        return (
          <div key={index} className="grid grid-cols-[4rem_minmax(0,1.4fr)_8.5rem_minmax(0,1fr)_1.5rem] items-center gap-1">
            {index === 0 ? (
              <span />
            ) : (
              <select
                aria-label={`And/Or for ${label}`}
                value={condition.conjunction}
                onChange={(event) => update(index, { conjunction: event.target.value as WiqlCondition["conjunction"] })}
                className={inputClass}
              >
                <option value="AND">And</option>
                <option value="OR">Or</option>
              </select>
            )}
            <DraftInput
              id={fieldInputId(index)}
              aria-label={`Field for ${label}`}
              list="view-condition-fields"
              value={condition.field}
              onCommit={(field) => update(index, { field: field.replace(/[[\]]/g, "") })}
              placeholder="System.State"
              spellCheck={false}
            />
            <select
              aria-label={`Operator for ${label}`}
              value={condition.operator}
              onChange={(event) => update(index, { operator: event.target.value })}
              className={inputClass}
            >
              {operatorsForFieldType(fieldTypes[condition.field], condition.operator).map((operator) => (
                <option key={operator} value={operator}>{operator}</option>
              ))}
            </select>
            <DraftInput
              aria-label={`Value for ${label}`}
              value={condition.value}
              onCommit={(value) => update(index, { value })}
              placeholder={condition.operator.endsWith("IN") ? "A, B" : "@Me, @Today - 7, text"}
            />
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={() => remove(index)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <button
          id={conditions.length === 0 ? CONDITION_GRID_FOCUS_ID : undefined}
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-secondary"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add condition
        </button>
        <span className="text-2xs text-muted-foreground">
          {hasProject ? "Edits update the WIQL below." : "Select a project to list its fields."}
        </span>
      </div>
    </div>
  );
}
