import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { wiAgentList, wiFilterNotes } from "./wiAgentList";

const item = (id: number, title: string): WorkItemSummary => ({
  organizationId: "contoso",
  projectId: "p",
  projectName: "Platform",
  id,
  title,
  workItemType: "Bug",
  state: "Active",
  assignedTo: "Alice",
  changedDate: "2026-10-10T01:02:03Z",
  webUrl: null,
  tags: "ui; urgent",
  extraFields: [],
  depth: null,
  hasActivePullRequest: false,
  hasDraftPullRequest: false,
});

describe("wiAgentList", () => {
  it("lists the visible items with the view's WIQL and the active column filters", () => {
    const scope = wiAgentList(
      { id: "work-item-view:bugs", title: "Work item view: Bugs", notes: ["WIQL: SELECT [System.Id]\nFROM WorkItems"] },
      [item(1, "Crash on save"), item(2, "Typo | label")],
      () => wiFilterNotes({ state: new Set(["Active", "New"]) }, true),
    );
    expect(scope).toMatchObject({ id: "work-item-view:bugs", label: "This list", count: 2 });
    const markdown = scope.markdown();
    expect(markdown).toContain("## Work item view: Bugs (2)");
    expect(markdown).toContain("- WIQL: SELECT [System.Id] FROM WorkItems");
    expect(markdown).toContain("- state: Active, New");
    expect(markdown).toContain("- Stale items only");
    expect(markdown).toContain("| #1 | Crash on save | Bug | Active | Alice | Platform | 2026-10-10 | ui; urgent |");
    expect(markdown).toContain("Typo \\| label");
  });
});
