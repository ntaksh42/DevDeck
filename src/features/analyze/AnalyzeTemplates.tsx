import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { TrendSparkline } from "./AnalyzeCharts";
import {
  createAnalyzeGroupId,
  createAnalyzeMemberId,
  type AnalyzeGroup,
} from "./analyzeGroupsStorage";

type TemplateQuery = { name: string; wiql: string; sample: number[] };

export type AnalyzeTemplate = {
  id: string;
  name: string;
  description: string;
  queries: TemplateQuery[];
};

const FROM = "SELECT [System.Id] FROM WorkItems WHERE";
const BUG_IN_STATE = (state: string) =>
  `${FROM} [System.WorkItemType] = 'Bug' AND [System.State] = '${state}'`;
const ASSIGNED_TO_ME_IN_STATE = (state: string) =>
  `${FROM} [System.AssignedTo] = @Me AND [System.State] = '${state}'`;

// Analyze groups only hold work item WIQL, so a pull request template is not possible;
// "Assigned to me by state" takes its place.
export const ANALYZE_TEMPLATES: AnalyzeTemplate[] = [
  {
    id: "bug-backlog",
    name: "Bug backlog by state",
    description: "New / Active / Resolved bugs, 30 days",
    queries: [
      { name: "New bugs", wiql: BUG_IN_STATE("New"), sample: [8, 9, 12, 11, 14, 13, 16, 15] },
      { name: "Active bugs", wiql: BUG_IN_STATE("Active"), sample: [20, 22, 21, 24, 23, 25, 24, 27] },
      { name: "Resolved bugs", wiql: BUG_IN_STATE("Resolved"), sample: [5, 4, 6, 5, 4, 3, 4, 2] },
    ],
  },
  {
    id: "team-wip",
    name: "My team's WIP",
    description: "Active Tasks and Bugs",
    queries: [
      {
        name: "Active tasks",
        wiql: `${FROM} [System.WorkItemType] = 'Task' AND [System.State] = 'Active'`,
        sample: [14, 16, 15, 18, 17, 19, 18, 20],
      },
      { name: "Active bugs", wiql: BUG_IN_STATE("Active"), sample: [9, 8, 10, 9, 11, 10, 9, 8] },
    ],
  },
  {
    id: "assigned-to-me",
    name: "Assigned to me by state",
    description: "My items: New / Active / Resolved",
    queries: [
      { name: "New (me)", wiql: ASSIGNED_TO_ME_IN_STATE("New"), sample: [3, 4, 4, 5, 6, 5, 7, 6] },
      { name: "Active (me)", wiql: ASSIGNED_TO_ME_IN_STATE("Active"), sample: [6, 7, 6, 8, 7, 9, 8, 9] },
      { name: "Resolved (me)", wiql: ASSIGNED_TO_ME_IN_STATE("Resolved"), sample: [1, 2, 1, 2, 3, 2, 2, 1] },
    ],
  },
  {
    id: "stale",
    name: "Stale work items",
    description: "Not changed in 30 days",
    queries: [
      {
        name: "Stale open items",
        wiql: `${FROM} [System.State] NOT IN ('Closed', 'Done', 'Removed') AND [System.ChangedDate] < @Today - 30`,
        sample: [30, 32, 35, 34, 38, 41, 40, 44],
      },
    ],
  },
];

export function buildGroupFromTemplate(
  template: AnalyzeTemplate,
  organizationId: string,
  projectId: string,
): AnalyzeGroup {
  return {
    id: createAnalyzeGroupId(),
    name: template.name,
    organizationId,
    projectId,
    queries: template.queries.map((query) => ({
      id: createAnalyzeMemberId(),
      name: query.name,
      projectId: "",
      wiql: query.wiql,
    })),
    granularity: "day",
    rangeCount: 30,
  };
}

export function AnalyzeTemplateList({
  focusedId,
  onFocusTemplate,
  onAddTemplate,
}: {
  focusedId: string;
  onFocusTemplate: (templateId: string) => void;
  onAddTemplate: (template: AnalyzeTemplate) => void;
}) {
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  function move(index: number) {
    const template = ANALYZE_TEMPLATES[index];
    if (!template) return;
    onFocusTemplate(template.id);
    rowRefs.current.get(template.id)?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, index: number) {
    // Let the nested Add button handle its own Enter/Space.
    if (event.target !== event.currentTarget) return;
    switch (event.key) {
      case "ArrowDown":
      case "j":
      case "J":
        move(Math.min(index + 1, ANALYZE_TEMPLATES.length - 1));
        break;
      case "ArrowUp":
      case "k":
      case "K":
        move(Math.max(index - 1, 0));
        break;
      case "Enter":
        onAddTemplate(ANALYZE_TEMPLATES[index]);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const focusedIndex = Math.max(
    0,
    ANALYZE_TEMPLATES.findIndex((template) => template.id === focusedId),
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Start from a template
      </div>
      {ANALYZE_TEMPLATES.map((template, index) => {
        const focused = index === focusedIndex;
        return (
          <div
            key={template.id}
            ref={(element) => {
              rowRefs.current.set(template.id, element);
            }}
            role="group"
            aria-label={template.name}
            aria-current={focused ? "true" : undefined}
            data-pane-focus-row="true"
            tabIndex={focused ? 0 : -1}
            onFocus={(event) => {
              if (event.target === event.currentTarget) onFocusTemplate(template.id);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              focused ? "border-primary bg-secondary" : "border-transparent hover:bg-muted/70"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{template.name}</div>
              <div className="truncate text-xs text-muted-foreground">{template.description}</div>
            </div>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onAddTemplate(template)}
              className="shrink-0 rounded border border-border bg-card px-2 py-0.5 text-xs hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Add
            </button>
          </div>
        );
      })}
      <p className="px-1 pt-2 text-xs text-muted-foreground">
        Press Enter to add the template, or N to create an empty group.
      </p>
    </div>
  );
}

export function AnalyzeTemplatePreview({ template }: { template: AnalyzeTemplate }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-baseline gap-2">
        <h2 className="truncate text-base font-semibold">{template.name}</h2>
        <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
          Sample
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Static sample data. Add the template to chart your own work items.
      </p>
      {template.queries.map((query) => (
        <div key={query.name} className="rounded-md border border-border p-3">
          <div className="mb-1 text-sm font-medium">{query.name}</div>
          <TrendSparkline
            label={`${query.name} (sample)`}
            points={query.sample.map((value, index) => ({ index, value }))}
          />
        </div>
      ))}
    </div>
  );
}
