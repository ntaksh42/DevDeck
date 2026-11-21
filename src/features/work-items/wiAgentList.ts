import { listMarkdown, type AgentListScope } from "@/components/agent/agentListScope";
import type { WorkItemSummary } from "@/lib/azdoCommands";

/** What a work item grid says about its list; the rows come from the grid itself. */
export type WiAgentListInfo = {
  /** Identifies the list (e.g. `work-item-view:{id}`); another list starts unattached. */
  id: string;
  title: string;
  /** Query / filter lines, e.g. the view's WIQL. */
  notes?: (string | null | undefined | false)[];
};

type Note = string | null | undefined | false;

/** `Column: a, b` lines for the active column filters. */
export function wiFilterNotes(filters: Partial<Record<string, Set<string>>>, staleOnly: boolean): Note[] {
  return [
    ...Object.entries(filters)
      .filter((entry): entry is [string, Set<string>] => !!entry[1])
      .map(([column, values]) => `${column}: ${[...values].join(", ")}`),
    staleOnly && "Stale items only",
  ];
}

export function wiAgentList(info: WiAgentListInfo, items: readonly WorkItemSummary[], extraNotes: () => Note[]): AgentListScope {
  return {
    id: info.id,
    label: "This list",
    count: items.length,
    markdown: () =>
      listMarkdown({
        title: info.title,
        notes: [...(info.notes ?? []), ...extraNotes()].map((note) => note || null),
        headers: ["Work item", "Title", "Type", "State", "Assigned to", "Project", "Changed", "Tags"],
        rows: items.map((item) => [
          `#${item.id}`,
          item.title,
          item.workItemType,
          item.state,
          item.assignedTo,
          item.projectName,
          item.changedDate?.slice(0, 10),
          item.tags,
        ]),
      }),
  };
}
