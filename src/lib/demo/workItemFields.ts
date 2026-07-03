import type {
  ClassificationNodesResult,
  ListWorkItemFieldAllowedValuesInput,
  ListWorkItemFieldsInput,
  ListWorkItemTypeStatesInput,
  MentionCandidate,
  WorkItemAssigneeCandidate,
  WorkItemFieldOption,
  WorkItemUpdateSummary,
} from "@/lib/azdoCommands";

export function demoListWorkItemFieldAllowedValues(
  input?: ListWorkItemFieldAllowedValuesInput,
): string[] {
  if (input?.fieldReferenceName === "Custom.CustomerImpact") {
    return ["Low", "Medium", "High"];
  }
  if (input?.fieldReferenceName === "Custom.ReleaseTrain") {
    return ["Tokyo", "Osaka", "Nagoya"];
  }
  return [];
}

export function demoWorkItemUpdates(): WorkItemUpdateSummary[] {
  return [
    {
      id: 3,
      revisedBy: "Alice Johnson",
      revisedDate: "2026-05-27T14:30:00Z",
      changes: [
        { referenceName: "System.State", oldValue: "New", newValue: "Active" },
        { referenceName: "System.Reason", oldValue: "New", newValue: "Work started" },
      ],
    },
    {
      id: 2,
      revisedBy: "Demo User",
      revisedDate: "2026-05-26T10:15:00Z",
      changes: [
        {
          referenceName: "System.AssignedTo",
          oldValue: null,
          newValue: "Demo User",
        },
        {
          referenceName: "Microsoft.VSTS.Common.Priority",
          oldValue: "3",
          newValue: "2",
        },
      ],
    },
    {
      id: 1,
      revisedBy: "Demo User",
      revisedDate: "2026-05-20T09:00:00Z",
      changes: [
        { referenceName: "System.Title", oldValue: null, newValue: "Created" },
      ],
    },
  ];
}

const DEMO_STATES_BY_TYPE: Record<string, string[]> = {
  Bug: ["New", "Active", "Resolved", "Closed"],
  Task: ["To Do", "In Progress", "Done"],
  "User Story": ["New", "Active", "Resolved", "Closed"],
  Feature: ["New", "In Progress", "Resolved", "Closed"],
  Epic: ["New", "In Progress", "Resolved", "Closed"],
  Issue: ["To Do", "Doing", "Done"],
};
const DEMO_STATES_FALLBACK = ["New", "Active", "Resolved", "Closed"];

export function demoListWorkItemTypeStates(input?: ListWorkItemTypeStatesInput): string[] {
  if (!input?.workItemType) return DEMO_STATES_FALLBACK;
  return DEMO_STATES_BY_TYPE[input.workItemType] ?? DEMO_STATES_FALLBACK;
}

export function demoListWorkItemTypes(): string[] {
  return Object.keys(DEMO_STATES_BY_TYPE);
}

export function demoListWorkItemFields(_input?: ListWorkItemFieldsInput): WorkItemFieldOption[] {
  return [
    { name: "Release Train", referenceName: "Custom.ReleaseTrain", fieldType: "string", custom: true },
    { name: "Customer Impact", referenceName: "Custom.CustomerImpact", fieldType: "string", custom: true },
    { name: "Escalation", referenceName: "Custom.Escalation", fieldType: "boolean", custom: true },
    { name: "Priority", referenceName: "Microsoft.VSTS.Common.Priority", fieldType: "integer", custom: false },
    { name: "Severity", referenceName: "Microsoft.VSTS.Common.Severity", fieldType: "string", custom: false },
    { name: "Story Points", referenceName: "Microsoft.VSTS.Scheduling.StoryPoints", fieldType: "double", custom: false },
  ];
}

export function demoClassificationNodes(): ClassificationNodesResult {
  return {
    areas: [
      { name: "Platform", path: "Platform", depth: 0, hasChildren: true, startDate: null, finishDate: null },
      { name: "Web", path: "Platform\\Web", depth: 1, hasChildren: false, startDate: null, finishDate: null },
      { name: "API", path: "Platform\\API", depth: 1, hasChildren: true, startDate: null, finishDate: null },
      { name: "Gateway", path: "Platform\\API\\Gateway", depth: 2, hasChildren: false, startDate: null, finishDate: null },
      { name: "Mobile", path: "Platform\\Mobile", depth: 1, hasChildren: false, startDate: null, finishDate: null },
    ],
    iterations: [
      { name: "Platform", path: "Platform", depth: 0, hasChildren: true, startDate: null, finishDate: null },
      {
        name: "Sprint 24",
        path: "Platform\\Sprint 24",
        depth: 1,
        hasChildren: false,
        startDate: "2026-05-11T00:00:00Z",
        finishDate: "2026-05-24T00:00:00Z",
      },
      {
        name: "Sprint 25",
        path: "Platform\\Sprint 25",
        depth: 1,
        hasChildren: false,
        startDate: "2026-05-25T00:00:00Z",
        finishDate: "2026-06-07T00:00:00Z",
      },
    ],
  };
}

const demoMentionPeople: MentionCandidate[] = [
  {
    id: "demo-alice",
    displayName: "Alice Johnson",
    uniqueName: "alice@contoso.example",
  },
  {
    id: "demo-bob",
    displayName: "Bob Tanaka",
    uniqueName: "bob@contoso.example",
  },
  {
    id: "demo-carol",
    displayName: "Carol Wang",
    uniqueName: "carol@contoso.example",
  },
  {
    id: "demo-frank",
    displayName: "Frank Lee",
    uniqueName: "frank@contoso.example",
  },
];

const demoAssigneePeople: WorkItemAssigneeCandidate[] = demoMentionPeople.map(
  (person) => ({
    ...person,
    assignValue: person.uniqueName
      ? `${person.displayName} <${person.uniqueName}>`
      : person.displayName,
  }),
);

export function demoMentionCandidates(query?: string): MentionCandidate[] {
  const term = query?.trim().toLowerCase() ?? "";
  if (!term) return demoMentionPeople;
  return demoMentionPeople.filter(
    (person) =>
      person.displayName.toLowerCase().includes(term) ||
      person.uniqueName?.toLowerCase().includes(term),
  );
}

export function demoAssigneeCandidates(query?: string): WorkItemAssigneeCandidate[] {
  const term = query?.trim().toLowerCase() ?? "";
  if (!term) return demoAssigneePeople;
  return demoAssigneePeople.filter(
    (person) =>
      person.displayName.toLowerCase().includes(term) ||
      person.uniqueName?.toLowerCase().includes(term),
  );
}
