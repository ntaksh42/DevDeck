// Demo Work Item preview and field edits, split from workItems.ts to keep
// files under 500 lines.
import type {
  GetWorkItemPreviewInput,
  UpdateWorkItemFieldsInput,
  WorkItemPreview,
} from "@/lib/azdoCommands";
import { applyWorkItemPreviewScenario } from "@/lib/azdoDemoHarness";
import {
  demoReactionsList,
  escapeDemoHtml,
  isDeletedDemoWorkItemComment,
} from "./workItemComments";
import { demoMyWorkItems, demoWorkItems } from "./workItems";

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
    ].filter((comment) => !isDeletedDemoWorkItemComment(comment.id)),
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
        repositoryId: "demo-repo-guid",
        title: null,
        status: null,
        myVoteLabel: null,
        webUrl: "https://dev.azure.com/contoso/demo-project-guid/_git/demo-repo-guid/pullrequest/9001",
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
