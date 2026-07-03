import { useState } from "react";
import { ArrowDown, ArrowUp, Palette, Plus, Trash2 } from "lucide-react";
import {
  ROW_COLORS,
  ROW_COLOR_FIELDS,
  ROW_COLOR_OPS,
  loadRowColorRules,
  saveRowColorRules,
  type RowColorRule,
} from "@/lib/rowColorRules";

function newRuleId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rule-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

// Manage conditional row color rules applied to the Work Item grids. Rules are
// evaluated top-to-bottom (first match wins) and persisted immediately so the
// grids react without a separate save step.
export function RowColorRulesSettings() {
  const [rules, setRules] = useState<RowColorRule[]>(() => loadRowColorRules());

  function commit(next: RowColorRule[]) {
    setRules(next);
    saveRowColorRules(next);
  }

  function updateRule(id: string, patch: Partial<RowColorRule>) {
    commit(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  function addRule() {
    commit([
      ...rules,
      { id: newRuleId(), field: "state", op: "equals", value: "", color: "red" },
    ]);
  }

  function removeRule(id: string) {
    commit(rules.filter((rule) => rule.id !== id));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  }

  const selectClass =
    "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Palette className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Row color rules</h2>
            <p className="text-sm text-muted-foreground">
              Tint Work Item grid rows by condition. The first matching rule wins.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-3">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules yet. Add one to highlight rows — for example, color rows where State equals
            “Blocked”.
          </p>
        ) : (
          rules.map((rule, index) => (
            <div
              key={rule.id}
              className="relative flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
            >
              <label className="sr-only" htmlFor={`field-${rule.id}`}>
                Field
              </label>
              <select
                id={`field-${rule.id}`}
                value={rule.field}
                onChange={(event) =>
                  updateRule(rule.id, { field: event.target.value as RowColorRule["field"] })
                }
                className={selectClass}
              >
                {ROW_COLOR_FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>

              <label className="sr-only" htmlFor={`op-${rule.id}`}>
                Operator
              </label>
              <select
                id={`op-${rule.id}`}
                value={rule.op}
                onChange={(event) =>
                  updateRule(rule.id, { op: event.target.value as RowColorRule["op"] })
                }
                className={selectClass}
              >
                {ROW_COLOR_OPS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              <input
                value={rule.value}
                onChange={(event) => updateRule(rule.id, { value: event.target.value })}
                placeholder="value"
                aria-label="Value"
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
              />

              <label className="sr-only" htmlFor={`color-${rule.id}`}>
                Color
              </label>
              <select
                id={`color-${rule.id}`}
                value={rule.color}
                onChange={(event) =>
                  updateRule(rule.id, { color: event.target.value as RowColorRule["color"] })
                }
                className={selectClass}
              >
                {ROW_COLORS.map((color) => (
                  <option key={color.value} value={color.value}>
                    {color.label}
                  </option>
                ))}
              </select>
              <span
                className={`h-4 w-4 shrink-0 rounded-full ${
                  ROW_COLORS.find((c) => c.value === rule.color)?.swatch ?? "bg-muted"
                }`}
                aria-hidden="true"
              />

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move rule up"
                  className="rounded-md border border-border p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rules.length - 1}
                  aria-label="Move rule down"
                  className="rounded-md border border-border p-1 text-muted-foreground hover:bg-accent disabled:opacity-40"
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => removeRule(rule.id)}
                  aria-label="Delete rule"
                  className="rounded-md border border-border p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))
        )}

        <div>
          <button
            type="button"
            onClick={addRule}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add rule
          </button>
        </div>
      </div>
    </div>
  );
}
