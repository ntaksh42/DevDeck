import type { WorkItemQueryView } from './workItemViewsStorage';

export type WiqlCompletion = {
  label: string;
  value: string;
  detail: string;
};

export const WIQL_COMPLETIONS: WiqlCompletion[] = [
  { label: "System.Id", value: "[System.Id]", detail: "Work item ID" },
  { label: "System.Title", value: "[System.Title]", detail: "Title" },
  { label: "System.State", value: "[System.State]", detail: "State" },
  { label: "System.WorkItemType", value: "[System.WorkItemType]", detail: "Type" },
  { label: "System.AssignedTo", value: "[System.AssignedTo]", detail: "Assignee" },
  { label: "System.ChangedDate", value: "[System.ChangedDate]", detail: "Changed date" },
  { label: "System.CreatedDate", value: "[System.CreatedDate]", detail: "Created date" },
  { label: "System.TeamProject", value: "[System.TeamProject]", detail: "Project" },
  { label: "System.Tags", value: "[System.Tags]", detail: "Tags" },
  { label: "Microsoft.VSTS.Common.Priority", value: "[Microsoft.VSTS.Common.Priority]", detail: "Priority" },
  { label: "Microsoft.VSTS.Common.Severity", value: "[Microsoft.VSTS.Common.Severity]", detail: "Severity" },
  { label: "@Me", value: "@Me", detail: "Current user" },
  { label: "@Today", value: "@Today", detail: "Today" },
  { label: "@CurrentIteration", value: "@CurrentIteration", detail: "Current iteration" },
  { label: "@Follows", value: "@Follows", detail: "Followed work items" },
  { label: "SELECT", value: "SELECT ", detail: "Projection" },
  { label: "FROM WorkItems", value: "FROM WorkItems", detail: "Work Item source" },
  { label: "WHERE", value: "WHERE ", detail: "Filter" },
  { label: "ORDER BY", value: "ORDER BY ", detail: "Sort" },
  { label: "CONTAINS WORDS", value: "CONTAINS WORDS ", detail: "Text contains" },
];

export function firstCustomView(views: WorkItemQueryView[]): WorkItemQueryView | null {
  return views.find((view) => !view.id.startsWith("builtin-")) ?? null;
}

export function newWorkItemViewId(): string {
  return `wi-view-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultWorkItemWiql(): string {
  return [
    "SELECT [System.Id]",
    "FROM WorkItems",
    "WHERE [System.TeamProject] = @project",
    "ORDER BY [System.ChangedDate] DESC",
  ].join("\n");
}

export function validateWiql(value: string): { errors: string[]; warnings: string[] } {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!normalized.startsWith("select ")) {
    errors.push("WIQL must start with SELECT.");
  }
  if (!/\bfrom\s+(workitems|workitemlinks)\b/.test(normalized)) {
    errors.push("WIQL must include FROM WorkItems or FROM WorkItemLinks.");
  }
  if (!/\bwhere\b/.test(normalized)) {
    warnings.push("Add a WHERE clause to avoid broad queries.");
  }
  if (!/\border\s+by\b/.test(normalized)) {
    warnings.push("Add ORDER BY for stable result ordering.");
  }
  return { errors, warnings };
}

export function wiqlTokenRange(
  value: string,
  cursor: number,
): { start: number; end: number; token: string } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const startMatch = /(?:^|[\s,=<>()[\]])([@\w.]*)$/.exec(before);
  const endMatch = /^([@\w.]*)/.exec(after);
  const token = `${startMatch?.[1] ?? ""}${endMatch?.[1] ?? ""}`;
  return {
    start: cursor - (startMatch?.[1]?.length ?? 0),
    end: cursor + (endMatch?.[1]?.length ?? 0),
    token,
  };
}

export function wiqlCompletionMatches(
  value: string,
  cursor: number,
  pool: WiqlCompletion[],
): WiqlCompletion[] {
  const token = wiqlTokenRange(value, cursor).token.toLowerCase();
  const normalizedToken = token.replace(/^\[/, "");
  return pool
    .filter((completion) => {
      const haystack = `${completion.label} ${completion.value} ${completion.detail}`.toLowerCase();
      return !normalizedToken || haystack.includes(normalizedToken);
    })
    .slice(0, 8);
}

export function parseAzdoQueryUrl(url: string): {
  orgName?: string;
  projectName?: string;
  queryId?: string;
} {
  if (!url.trim()) return {};
  try {
    const u = new URL(url.trim());
    const { hostname, pathname } = u;
    let orgName: string | undefined;
    let projectName: string | undefined;
    let queryId: string | undefined;

    if (hostname === "dev.azure.com") {
      const match =
        /^\/([^/]+)\/([^/]+)\/_queries\/query(?:-edit)?\/([0-9a-f-]{36})/i.exec(pathname);
      if (match) {
        orgName = decodeURIComponent(match[1]);
        projectName = decodeURIComponent(match[2]);
        queryId = match[3];
      } else {
        const parts = pathname.split("/").filter(Boolean);
        if (parts[0]) orgName = decodeURIComponent(parts[0]);
        if (parts[1]) projectName = decodeURIComponent(parts[1]);
      }
    } else if (hostname.endsWith(".visualstudio.com")) {
      orgName = hostname.split(".")[0];
      const match =
        /^\/([^/]+)\/_queries\/query(?:-edit)?\/([0-9a-f-]{36})/i.exec(pathname);
      if (match) {
        projectName = decodeURIComponent(match[1]);
        queryId = match[2];
      } else {
        const parts = pathname.split("/").filter(Boolean);
        if (parts[0]) projectName = decodeURIComponent(parts[0]);
      }
    }

    return { orgName, projectName, queryId };
  } catch {
    return {};
  }
}

export function viewExportFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `azdodeck-work-item-views-${stamp}.json`;
}

export function viewCardColumnCount(container: HTMLElement): number {
  const styles = window.getComputedStyle(container);
  const templateColumns = styles.gridTemplateColumns;
  if (templateColumns && templateColumns !== "none" && !templateColumns.includes("repeat(")) {
    const columns = templateColumns.split(/\s+/).filter(Boolean).length;
    if (columns > 0) return columns;
  }

  const columnGap = Number.parseFloat(styles.columnGap) || 0;
  const minCardWidth = 180;
  const width = container.clientWidth;
  if (width > 0) {
    return Math.max(1, Math.floor((width + columnGap) / (minCardWidth + columnGap)));
  }

  return 1;
}
