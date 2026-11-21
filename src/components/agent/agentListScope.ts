import { useEffect, useRef, useSyncExternalStore } from "react";

// The list a view shows (its visible rows and filters), offered to the Agent
// panel as optional context next to the selected item. It is never attached
// by default: the panel's "+ This list" chip attaches it for the next request.

export type AgentListScope = {
  /** Identifies the list (view + view-specific query); the attached state follows it. */
  id: string;
  /** Chip text; "This list" unless the list is something more specific. */
  label: string;
  count: number;
  /** The list as Markdown; called only when a request is sent, so it sees the current rows. */
  markdown: () => string;
};

let current: AgentListScope | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function publishAgentListScope(scope: AgentListScope | null): void {
  if (current === scope) return;
  current = scope;
  emit();
}

export function useAgentListScope(): AgentListScope | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/**
 * Publishes a view's list while it is mounted. `null` publishes "no list"; `undefined`
 * leaves the store to another view. The rows are read lazily, so a new array on every
 * render does not matter; only `id`, `label` and `count` republish.
 */
export function usePublishAgentListScope(scope: AgentListScope | null | undefined): void {
  const latest = useRef(scope);
  latest.current = scope;
  const mode = scope === undefined ? 0 : scope === null ? 1 : 2;
  const id = scope?.id;
  const label = scope?.label;
  const count = scope?.count;
  useEffect(() => {
    if (!scope) {
      if (scope === null) publishAgentListScope(null);
      return;
    }
    const mine: AgentListScope = {
      id: scope.id,
      label: scope.label,
      count: scope.count,
      markdown: () => latest.current?.markdown() ?? scope.markdown(),
    };
    publishAgentListScope(mine);
    return () => {
      if (current === mine) publishAgentListScope(null);
    };
    // The id, label and count identify the list; the object itself is rebuilt each render.
  }, [mode, id, label, count]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Markdown ────────────────────────────────────────────────────────────────

export const LIST_ROW_CAP = 200;

type Cell = string | number | null | undefined;

const cell = (value: Cell): string =>
  String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

/** A Markdown table of at most `LIST_ROW_CAP` rows; the rest is counted, not listed. */
export function markdownTable(headers: string[], rows: Cell[][]): string {
  const shown = rows.slice(0, LIST_ROW_CAP);
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...shown.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
  if (rows.length > shown.length) lines.push("", `(${rows.length - shown.length} more rows not shown)`);
  return lines.join("\n");
}

/** The list section of a context document: a heading, the active filters, then the table. */
export function listMarkdown(input: {
  title: string;
  /** Active filters / query lines, e.g. `Text: retry`, `WIQL: SELECT …`. */
  notes?: (string | null | undefined)[];
  headers: string[];
  rows: Cell[][];
}): string {
  const notes = (input.notes ?? []).filter((note): note is string => !!note).map((note) => `- ${note.replace(/\s+/g, " ").trim()}`);
  return [
    `## ${input.title} (${input.rows.length})`,
    ...(notes.length ? [notes.join("\n")] : []),
    markdownTable(input.headers, input.rows),
  ].join("\n\n");
}
