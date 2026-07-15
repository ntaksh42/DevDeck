import { organization } from "./appTestHelpers";

export function workItemsSearchInvoke(
  command: string,
  args?: unknown,
): Promise<unknown> {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "list_work_item_projects") {
        return Promise.resolve([
          {
            projectId: "project-1",
            projectName: "Platform",
          },
        ]);
      }
      if (command === "search_work_items") {
        return Promise.resolve([
          {
            organizationId: "contoso",
            projectId: "project-1",
            projectName: "Platform",
            id: 123,
            title: "Fix save workflow",
            workItemType: "Bug",
            state: "Active",
            assignedTo: "Test User",
            changedDate: "2026-05-24T00:00:00Z",
            webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
          },
          {
            organizationId: "contoso",
            projectId: "project-1",
            projectName: "Platform",
            id: 124,
            title: "Review save workflow",
            workItemType: "Task",
            state: "Active",
            assignedTo: "Test User",
            changedDate: "2026-05-23T00:00:00Z",
            webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/124",
          },
        ]);
      }
      if (command === "get_work_item_preview") {
        return Promise.resolve({
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 123,
          title: "Fix save workflow",
          workItemType: "Bug",
          state: "Active",
          assignedTo: "Test User",
          assignedToUniqueName: null,
          createdBy: "Creator",
          createdDate: "2026-05-23T00:00:00Z",
          changedDate: "2026-05-24T00:00:00Z",
          areaPath: "Platform\\Product",
          iterationPath: "Platform\\Sprint 24",
          reason: "Work started",
          tags: "save; bug",
          priority: "1",
          severity: "2 - High",
          storyPoints: null,
          remainingWork: null,
          descriptionHtml:
            '<p>Fix the save flow.</p><img src="https://example.test/save-flow.png" alt="Save flow diagram">',
          acceptanceCriteriaHtml: "<ul><li>Save succeeds</li></ul>",
          webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
          comments: [
            {
              id: 8,
              text: '<div><a href="#" data-vss-mention="version:2.0,9ce68702-0694-6ef4-b9fa-0f3143502233">@Creator</a>&nbsp;Posted from Azure</div>',
              renderedText:
                '&lt;div&gt;&lt;a href=&quot;#&quot; data-vss-mention=&quot;version:2.0,9ce68702-0694-6ef4-b9fa-0f3143502233&quot;&gt;@Creator&lt;/a&gt;&amp;nbsp;Posted from Azure&lt;/div&gt;',
              createdBy: "Creator",
              createdById: "9ce68702-0694-6ef4-b9fa-0f3143502233",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T13:00:00Z",
            },
            {
              id: 7,
              text: "@<9ce68702-0694-6ef4-b9fa-0f3143502233> Earlier context",
              renderedText: "<p>@&lt;9ce68702-0694-6ef4-b9fa-0f3143502233&gt; Earlier context</p>",
              createdBy: "Creator",
              createdById: "9ce68702-0694-6ef4-b9fa-0f3143502233",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T12:00:00Z",
            },
            {
              id: 6,
              text: '<div><a href="#" data-vss-mention="version:2.0,user-reviewer">@Reviewer</a>&nbsp;Raw text fallback</div><div><br></div>',
              renderedText: null,
              createdBy: "Reviewer",
              createdById: "user-reviewer",
              createdByUniqueName: "reviewer@example.com",
              createdDate: "2026-05-23T11:30:00Z",
            },
            {
              id: 5,
              text: "Older context",
              renderedText: "<p>Older context</p>",
              createdBy: "Reviewer",
              createdById: "user-reviewer",
              createdByUniqueName: "reviewer@example.com",
              createdDate: "2026-05-23T11:00:00Z",
            },
          ],
        });
      }
      if (command === "search_work_item_mentions") {
        return Promise.resolve([
          {
            id: "9ce68702-0694-6ef4-b9fa-0f3143502233",
            displayName: "Creator",
            uniqueName: "creator@example.com",
          },
        ]);
      }
      if (command === "search_work_item_assignees") {
        return Promise.resolve([
          {
            id: "9ce68702-0694-6ef4-b9fa-0f3143502233",
            displayName: "Creator",
            uniqueName: "creator@example.com",
            assignValue: "Creator <creator@example.com>",
          },
        ]);
      }
      if (command === "update_work_item_fields") {
        const fields =
          (
            args as
              | { input?: { fields?: { referenceName: string; value: string }[] } }
              | undefined
          )?.input?.fields ?? [];
        const stateValue = fields.find((f) => f.referenceName === "System.State")?.value;
        const assigneeValue = fields.find(
          (f) => f.referenceName === "System.AssignedTo",
        )?.value;
        return Promise.resolve({
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 123,
          title: "Fix save workflow",
          workItemType: "Bug",
          state: stateValue ?? "Active",
          assignedTo: assigneeValue?.startsWith("Creator") ? "Creator" : "Test User",
          assignedToUniqueName: null,
          createdBy: "Creator",
          createdDate: "2026-05-23T00:00:00Z",
          changedDate: "2026-05-24T01:00:00Z",
          areaPath: "Platform\\Product",
          iterationPath: "Platform\\Sprint 24",
          reason: "Work started",
          tags: "save; bug",
          priority: "1",
          severity: "2 - High",
          storyPoints: null,
          remainingWork: null,
          descriptionHtml:
            '<p>Fix the save flow.</p><img src="https://example.test/save-flow.png" alt="Save flow diagram">',
          acceptanceCriteriaHtml: "<ul><li>Save succeeds</li></ul>",
          webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
          comments: [
            {
              id: 7,
              text: "Earlier context",
              renderedText: "<p>Earlier context</p>",
              createdBy: "Creator",
              createdById: "9ce68702-0694-6ef4-b9fa-0f3143502233",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T12:00:00Z",
            },
          ],
        });
      }
      if (command === "add_work_item_comment") {
        return Promise.resolve({
          id: 1,
          text: "@<9ce68702-0694-6ef4-b9fa-0f3143502233> please check",
          renderedText: "<p>@Creator please check</p>",
          createdBy: "Test User",
          createdDate: "2026-05-24T00:00:00Z",
        });
      }
      if (command === "update_work_item_comment") {
        const input =
          (args as { input?: { commentId?: number; markdown?: string } } | undefined)
            ?.input ?? {};
        const markdown = input.markdown ?? "";
        return Promise.resolve({
          id: input.commentId ?? 7,
          text: markdown,
          renderedText: `<p>${markdown}</p>`,
          createdBy: "Creator",
          createdDate: "2026-05-23T12:00:00Z",
        });
      }
      if (command === "list_work_item_type_states") {
        return Promise.resolve(["Active", "Resolved", "Closed"]);
      }
      if (command === "record_mention_interaction") {
        return Promise.resolve(null);
      }
      if (command === "record_assignee_interaction") {
        return Promise.resolve(null);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
}
