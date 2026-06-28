import type {
  GetWorkItemPreviewInput,
  RunWorkItemQueryInput,
  SearchWorkItemsInput,
  UpdateWorkItemFieldsInput,
  WorkItemComment,
  WorkItemPreview,
  WorkItemProjectOption,
  WorkItemSummary,
} from "@/lib/azdoCommands";
import {
  applyWorkItemPreviewScenario,
  applyWorkItemScenario,
} from "@/lib/azdoDemoHarness";

// In-memory deleted comment ids for browser demo mode. Filtered out by
// demoWorkItemPreview so deletions persist across refetches in the session.
const deletedDemoWorkItemComments = new Set<number>();

export function deleteDemoWorkItemComment(commentId: number): void {
  deletedDemoWorkItemComments.add(commentId);
}

// In-memory work item comment reactions for browser demo mode, keyed by comment
// id then reaction type, so toggling a reaction sticks across refetches.
const demoCommentReactions = new Map<number, Map<string, { count: number; isMine: boolean }>>();
let demoCommentReactionsSeeded = false;

function demoReactionsFor(commentId: number): Map<string, { count: number; isMine: boolean }> {
  if (!demoCommentReactionsSeeded) {
    demoCommentReactionsSeeded = true;
    demoCommentReactions.set(
      2,
      new Map([
        ["like", { count: 2, isMine: true }],
        ["heart", { count: 1, isMine: false }],
      ]),
    );
  }
  let reactions = demoCommentReactions.get(commentId);
  if (!reactions) {
    reactions = new Map();
    demoCommentReactions.set(commentId, reactions);
  }
  return reactions;
}

export function demoReactionsList(
  commentId: number,
): Array<{ reactionType: string; count: number; isMine: boolean }> {
  return [...demoReactionsFor(commentId).entries()]
    .filter(([, value]) => value.count > 0)
    .map(([reactionType, value]) => ({ reactionType, ...value }));
}

export function toggleDemoReaction(commentId: number, type: string, engaged: boolean): void {
  const reactions = demoReactionsFor(commentId);
  const current = reactions.get(type) ?? { count: 0, isMine: false };
  if (engaged && !current.isMine) {
    reactions.set(type, { count: current.count + 1, isMine: true });
  } else if (!engaged && current.isMine) {
    reactions.set(type, { count: Math.max(0, current.count - 1), isMine: false });
  }
}

export function escapeDemoHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function demoWorkItemComment(markdown?: string): WorkItemComment {
  return {
    id: Date.now(),
    text: markdown ?? "",
    renderedText: `<p>${escapeDemoHtml(markdown ?? "")}</p>`,
    createdBy: "Demo User",
    createdById: "demo-user",
    createdByUniqueName: "demo.user@contoso.example",
    createdDate: new Date().toISOString(),
  };
}

export function withEmptyExtraFields(
  items: Omit<WorkItemSummary, "extraFields" | "depth">[],
): WorkItemSummary[] {
  return items.map((item) => ({ ...item, extraFields: [], depth: null }));
}

export function demoWorkItems(input?: SearchWorkItemsInput): WorkItemSummary[] {
  const all: Omit<WorkItemSummary, "extraFields" | "depth">[] = [
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 123,
      title: "Validate onboarding with PAT credentials",
      workItemType: "Task",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-27T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/123",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 118,
      title: "Rate limiting middleware causes 429 cascade on retries",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Alice Johnson",
      changedDate: "2026-05-26T15:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/118",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 110,
      title: "Migrate token signing to RS256",
      workItemType: "User Story",
      state: "Resolved",
      assignedTo: "Bob Tanaka",
      changedDate: "2026-05-25T09:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/110",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 95,
      title: "Add OpenTelemetry span propagation to API gateway",
      workItemType: "Feature",
      state: "New",
      assignedTo: "Grace Chen",
      changedDate: "2026-05-24T11:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/95",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 187,
      title: "Fix crash on launch for Android 14",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Frank Lee",
      changedDate: "2026-05-26T14:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/187",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 175,
      title: "Add biometric auth for payment screen",
      workItemType: "User Story",
      state: "Active",
      assignedTo: "Carol Wang",
      changedDate: "2026-05-25T16:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/175",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 160,
      title: "Dark mode support for all screens",
      workItemType: "Feature",
      state: "New",
      assignedTo: null,
      changedDate: "2026-05-23T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/160",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      id: 51,
      title: "Upgrade EKS cluster to 1.29",
      workItemType: "Epic",
      state: "Active",
      assignedTo: "Eve Nakamura",
      changedDate: "2026-05-27T07:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_workitems/edit/51",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      id: 44,
      title: "Set up Datadog APM for production workloads",
      workItemType: "Task",
      state: "Closed",
      assignedTo: "Eve Nakamura",
      changedDate: "2026-05-20T12:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_workitems/edit/44",
    },
  ];

  const query = input?.query?.trim().toLowerCase();
  const stateFilter = new Set((input?.states ?? []).filter(Boolean));
  const typeFilter = new Set((input?.workItemTypes ?? []).filter(Boolean));
  const projectFilter = new Set((input?.projectIds ?? []).filter(Boolean));

  return applyWorkItemScenario(withEmptyExtraFields(all)).filter((item) => {
    if (projectFilter.size > 0 && !projectFilter.has(item.projectId)) return false;
    if (stateFilter.size > 0 && !(item.state && stateFilter.has(item.state))) return false;
    if (typeFilter.size > 0 && !(item.workItemType && typeFilter.has(item.workItemType))) return false;
    if (query) {
      const textMatch = [item.title, item.projectName, item.workItemType ?? "", item.state ?? "", item.assignedTo ?? ""].some(
        (v) => v.toLowerCase().includes(query),
      );
      const idMatch = /^\d+$/.test(query) && String(item.id).startsWith(query);
      if (!textMatch && !idMatch) return false;
    }
    return true;
  });
}

export function demoMyWorkItems(): WorkItemSummary[] {
  return applyWorkItemScenario(withEmptyExtraFields([
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 201,
      title: "Implement My Work Items panel",
      workItemType: "Task",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-27T08:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/201",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 123,
      title: "Validate onboarding with PAT credentials",
      workItemType: "Task",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-26T10:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/123",
    },
    {
      organizationId: "contoso",
      projectId: "mobile",
      projectName: "Mobile",
      id: 187,
      title: "Fix crash on launch for Android 14",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-25T14:30:00Z",
      webUrl: "https://dev.azure.com/contoso/Mobile/_workitems/edit/187",
    },
    {
      organizationId: "contoso",
      projectId: "platform",
      projectName: "Platform",
      id: 155,
      title: "Write ADR for auth middleware rewrite",
      workItemType: "Task",
      state: "New",
      assignedTo: "Demo User",
      changedDate: "2026-05-24T10:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Platform/_workitems/edit/155",
    },
    {
      organizationId: "contoso",
      projectId: "infrastructure",
      projectName: "Infrastructure",
      id: 51,
      title: "Upgrade EKS cluster to 1.29",
      workItemType: "Epic",
      state: "Active",
      assignedTo: "Demo User",
      changedDate: "2026-05-23T07:00:00Z",
      webUrl: "https://dev.azure.com/contoso/Infrastructure/_workitems/edit/51",
    },
  ]));
}

export function demoWorkItemProjects(): WorkItemProjectOption[] {
  const projects = new Map<string, string>();
  for (const item of [...demoWorkItems(), ...demoMyWorkItems()]) {
    projects.set(item.projectId, item.projectName);
  }
  return [...projects.entries()]
    .map(([projectId, projectName]) => ({ projectId, projectName }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export function demoRunWorkItemQuery(input?: RunWorkItemQueryInput): WorkItemSummary[] {
  const wiql = input?.wiql.toLowerCase() ?? "";
  let results = demoWorkItems({ projectIds: input?.projectId ? [input.projectId] : undefined });

  const stateMatch = /\[system\.state\]\s*=\s*'([^']+)'/.exec(wiql);
  if (stateMatch) {
    const state = stateMatch[1].toLowerCase();
    results = results.filter((item) => item.state?.toLowerCase() === state);
  }

  const typeMatch = /\[system\.workitemtype\]\s*=\s*'([^']+)'/.exec(wiql);
  if (typeMatch) {
    const workItemType = typeMatch[1].toLowerCase();
    results = results.filter((item) => item.workItemType?.toLowerCase() === workItemType);
  }

  const titleMatch = /\[system\.title\]\s+contains\s+'([^']+)'/.exec(wiql);
  if (titleMatch) {
    const term = titleMatch[1].toLowerCase();
    results = results.filter((item) => item.title.toLowerCase().includes(term));
  }

  const extraFields = input?.extraFields ?? [];
  const isLinkQuery = /\bfrom\s+workitemlinks\b/.test(wiql);
  return results.slice(0, input?.limit ?? 200).map((item, index) => ({
    ...item,
    extraFields: extraFields.map((referenceName) => ({
      referenceName,
      value: demoExtraFieldValue(referenceName, item),
    })),
    depth: isLinkQuery ? (index % 3 === 0 ? 0 : 1) : null,
  }));
}

function demoExtraFieldValue(referenceName: string, item: WorkItemSummary): string | null {
  const lower = referenceName.toLowerCase();
  if (lower.endsWith(".priority")) return String((item.id % 4) + 1);
  if (lower.endsWith(".storypoints")) return String((item.id % 8) + 1);
  if (lower.endsWith(".severity")) return `${(item.id % 4) + 1} - Medium`;
  if (lower === "system.areapath") return item.projectName;
  if (lower === "system.iterationpath") return `${item.projectName}\\Sprint ${(item.id % 3) + 1}`;
  return null;
}

export function demoWorkItemPreview(input?: GetWorkItemPreviewInput): WorkItemPreview {
  const allItems = [...demoWorkItems(), ...demoMyWorkItems()];
  const summary =
    allItems.find(
      (item) =>
        item.id === input?.workItemId &&
        (!input?.projectId || item.projectId === input.projectId),
    ) ?? allItems[0];

  return applyWorkItemPreviewScenario({
    organizationId: summary.organizationId,
    projectId: summary.projectId,
    projectName: summary.projectName,
    id: summary.id,
    title: summary.title,
    workItemType: summary.workItemType,
    state: summary.state,
    assignedTo: summary.assignedTo,
    assignedToUniqueName: summary.assignedTo
      ? `${summary.assignedTo.split(" ")[0]!.toLowerCase()}@example.com`
      : null,
    createdBy: "Demo User",
    createdDate: "2026-05-20T09:00:00Z",
    changedDate: summary.changedDate,
    areaPath: `${summary.projectName}\\Product`,
    iterationPath: `${summary.projectName}\\Sprint 24`,
    reason: summary.state === "Closed" ? "Completed" : "Work started",
    tags: "dashboard; preview; demo",
    priority: summary.workItemType === "Bug" ? "1" : "2",
    severity: summary.workItemType === "Bug" ? "2 - High" : null,
    storyPoints: summary.workItemType === "User Story" ? "5" : null,
    remainingWork: summary.workItemType === "Task" ? "3" : null,
    descriptionHtml: `<p>Review background and expected behavior for ${escapeDemoHtml(summary.title)}.</p><ul><li>Fetch detail fields from Azure DevOps</li><li>Display in the right-side preview pane</li></ul><p><img alt="Demo preview image" src="https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_apis/wit/attachments/demo-preview-image?fileName=preview.svg"></p>`,
    acceptanceCriteriaHtml:
      "<ul><li>Selected work item syncs with the preview pane</li><li>HTML fields are rendered in a sandbox</li></ul>",
    customFields: (input?.customFields ?? []).map((referenceName, index) => ({
      referenceName,
      value:
        referenceName === "Custom.ReleaseTrain"
          ? "Tokyo"
          : referenceName === "Custom.CustomerImpact"
            ? "High"
            : `Demo value ${index + 1}`,
    })),
    webUrl: summary.webUrl,
    commentsUnavailable: false,
    comments: [
      {
        id: 2,
        text: "LGTM — shipped this in the last sprint, no blockers.",
        renderedText: "<p>LGTM — shipped this in the last sprint, no blockers.</p>",
        createdBy: "Alice Johnson",
        createdById: "demo-alice",
        createdByUniqueName: "alice@contoso.example",
        createdDate: "2026-05-27T14:00:00Z",
        reactions: demoReactionsList(2),
      },
      {
        id: 1,
        text: "Needs AC review before moving to Active.",
        renderedText: "<p>Needs AC review before moving to Active.</p>",
        createdBy: "Demo User",
        createdById: "demo-user",
        createdByUniqueName: "demo.user@contoso.example",
        createdDate: "2026-05-26T09:00:00Z",
        reactions: demoReactionsList(1),
      },
    ].filter((comment) => !deletedDemoWorkItemComments.has(comment.id)),
    relations: [
      {
        relationType: "Parent",
        id: 90,
        title: "Improve dashboard operations experience",
        state: "Active",
        workItemType: "Feature",
        webUrl: `https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_workitems/edit/90`,
      },
      {
        relationType: "Child",
        id: summary.id + 1000,
        title: `Subtask for ${summary.title}`,
        state: "New",
        workItemType: "Task",
        webUrl: `https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_workitems/edit/${summary.id + 1000}`,
      },
      {
        relationType: "Related",
        id: 77,
        title: "Track API rate limits in client retries",
        state: "Closed",
        workItemType: "Bug",
        webUrl: `https://dev.azure.com/contoso/${encodeURIComponent(summary.projectName)}/_workitems/edit/77`,
      },
    ],
    pullRequests: [
      {
        pullRequestId: 101,
        repositoryId: "api-gateway",
        title: "Add rate limiter to API gateway",
        status: "Active",
        myVoteLabel: "No Vote",
        webUrl: "https://dev.azure.com/contoso/demo-project/_git/api-gateway/pullrequest/101",
      },
      {
        pullRequestId: 9001,
        repositoryId: null,
        title: null,
        status: null,
        myVoteLabel: null,
        webUrl: null,
      },
    ],
    attachments: [
      {
        name: "repro-steps.png",
        url: "https://dev.azure.com/contoso/_apis/wit/attachments/demo-attachment-1",
      },
      {
        name: "diagnostics.log",
        url: "https://dev.azure.com/contoso/_apis/wit/attachments/demo-attachment-2",
      },
    ],
  });
}

export function demoUpdateWorkItemFields(input?: UpdateWorkItemFieldsInput): WorkItemPreview {
  let preview = demoWorkItemPreview(
    input
      ? { organizationId: input.organizationId, projectId: input.projectId, workItemId: input.workItemId }
      : undefined,
  );
  for (const field of input?.fields ?? []) {
    const referenceName = field.referenceName.trim();
    const value = field.value.trim();
    if (referenceName === "System.Title" && value) preview = { ...preview, title: value };
    else if (referenceName === "System.State" && value) preview = { ...preview, state: value };
    else if (referenceName === "System.Reason" && value) preview = { ...preview, reason: value };
    else if (referenceName === "System.AssignedTo") preview = { ...preview, assignedTo: value || null };
    else if (referenceName === "System.Tags") preview = { ...preview, tags: value || null };
    else if (referenceName === "Microsoft.VSTS.Common.Priority" && value) preview = { ...preview, priority: value };
    else if (referenceName) {
      const others = preview.customFields.filter(
        (existing) => existing.referenceName.toLowerCase() !== referenceName.toLowerCase(),
      );
      preview = { ...preview, customFields: [...others, { referenceName, value }] };
    }
  }
  return { ...preview, changedDate: new Date().toISOString() };
}

