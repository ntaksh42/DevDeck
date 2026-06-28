import { describe, expect, it } from "vitest";
import type { WorkItemPreview } from "@/lib/azdoCommands";
import {
  markdownWithHardLineBreaks,
  presetFieldsFromStaged,
  splitWorkItemTags,
  stagedChangesFromPresetFields,
  workItemStateDotClass,
  workItemTypeColor,
} from "./WorkItemPreviewPanel";

function makePreview(overrides: Partial<WorkItemPreview> = {}): WorkItemPreview {
  return {
    organizationId: "contoso",
    projectId: "project-1",
    projectName: "Platform",
    id: 123,
    title: "Fix bug",
    workItemType: "Bug",
    state: "Active",
    assignedTo: null,
    assignedToUniqueName: null,
    createdBy: null,
    createdDate: null,
    changedDate: null,
    areaPath: null,
    iterationPath: null,
    reason: "Approved",
    tags: null,
    priority: "2",
    severity: null,
    storyPoints: null,
    remainingWork: null,
    descriptionHtml: null,
    acceptanceCriteriaHtml: null,
    customFields: [],
    webUrl: null,
    comments: [],
    commentsUnavailable: false,
    relations: [],
    pullRequests: [],
    attachments: [],
    ...overrides,
  };
}

describe("work item preview presentation helpers", () => {
  it("maps known work item types to Azure DevOps colors", () => {
    expect(workItemTypeColor("Bug")).toBe("#CC293D");
    expect(workItemTypeColor("user story")).toBe("#009CCC");
    expect(workItemTypeColor(" Task ")).toBe("#F2CB1D");
    expect(workItemTypeColor("Custom Type")).toBe("#64748B");
  });

  it("maps states to colored dots with a fallback", () => {
    expect(workItemStateDotClass("Done")).toBe("bg-green-500");
    expect(workItemStateDotClass("closed")).toBe("bg-green-500");
    expect(workItemStateDotClass("Resolved")).toBe("bg-amber-500");
    expect(workItemStateDotClass("In Progress")).toBe("bg-blue-500");
    expect(workItemStateDotClass("Removed")).toBe("bg-slate-300");
    expect(workItemStateDotClass("New")).toBe("bg-slate-400");
    expect(workItemStateDotClass("チーム独自状態")).toBe("bg-slate-400");
  });

  it("splits semicolon-separated tags and drops blanks", () => {
    expect(splitWorkItemTags("save; bug; ")).toEqual(["save", "bug"]);
    expect(splitWorkItemTags(null)).toEqual([]);
    expect(splitWorkItemTags("  ")).toEqual([]);
  });

  it("deduplicates repeated tags", () => {
    expect(splitWorkItemTags("save; bug; save")).toEqual(["save", "bug"]);
  });
});

describe("markdownWithHardLineBreaks", () => {
  it("turns single newlines into markdown hard breaks", () => {
    expect(markdownWithHardLineBreaks("@田中 太郎\nこんにちは")).toBe(
      "@田中 太郎  \nこんにちは",
    );
  });

  it("leaves paragraph breaks (blank lines) untouched", () => {
    expect(markdownWithHardLineBreaks("first\n\nsecond")).toBe(
      "first\n\nsecond",
    );
  });

  it("does not add trailing spaces inside fenced code blocks", () => {
    expect(markdownWithHardLineBreaks("before\n```\nlet a = 1;\nlet b = 2;\n```\nafter")).toBe(
      "before  \n```\nlet a = 1;\nlet b = 2;\n```\nafter",
    );
  });

  it("normalizes CRLF and keeps the last line unchanged", () => {
    expect(markdownWithHardLineBreaks("a\r\nb")).toBe("a  \nb");
  });
});

describe("presetFieldsFromStaged", () => {
  it("serializes staged changes with state before reason", () => {
    expect(
      presetFieldsFromStaged({
        state: "Resolved",
        reason: "Won't Fix",
        priority: 3,
        tags: ["triage", "backlog"],
        fields: { "Custom.Team": { label: "Team", value: "Core" } },
      }),
    ).toEqual([
      { referenceName: "Microsoft.VSTS.Common.Priority", label: "Priority", value: "3" },
      { referenceName: "System.Tags", label: "Tags", value: "triage; backlog" },
      { referenceName: "Custom.Team", label: "Team", value: "Core" },
      { referenceName: "System.State", label: "State", value: "Resolved" },
      { referenceName: "System.Reason", label: "Reason", value: "Won't Fix" },
    ]);
  });

  it("serializes a staged assignee as System.AssignedTo", () => {
    expect(
      presetFieldsFromStaged({
        assignee: { assignValue: "Alice <alice@corp.com>", displayName: "Alice" },
      }),
    ).toEqual([
      {
        referenceName: "System.AssignedTo",
        label: "Assignee",
        value: "Alice <alice@corp.com>",
      },
    ]);
  });

  it("returns an empty list when nothing is staged", () => {
    expect(presetFieldsFromStaged({})).toEqual([]);
  });
});

describe("stagedChangesFromPresetFields", () => {
  const resolveAsWontFix = [
    { referenceName: "System.State", label: "State", value: "Resolved" },
    { referenceName: "System.Reason", label: "Reason", value: "Won't Fix" },
  ];

  it("stages state and reason onto their dedicated slots", () => {
    expect(stagedChangesFromPresetFields(resolveAsWontFix, makePreview())).toEqual({
      state: "Resolved",
      reason: "Won't Fix",
    });
  });

  it("skips fields that already match the work item", () => {
    const preview = makePreview({ state: "Resolved", reason: "Won't Fix" });
    expect(stagedChangesFromPresetFields(resolveAsWontFix, preview)).toEqual({});
  });

  it("round-trips through presetFieldsFromStaged", () => {
    const staged = {
      state: "Resolved",
      reason: "Won't Fix",
      priority: 3,
      tags: ["triage"],
      fields: { "Custom.Team": { label: "Team", value: "Core" } },
    };
    expect(
      stagedChangesFromPresetFields(presetFieldsFromStaged(staged), makePreview()),
    ).toEqual(staged);
  });

  it("maps assignee, priority, tags, and custom fields", () => {
    const fields = [
      { referenceName: "System.AssignedTo", label: "Assignee", value: "Alice <alice@corp.com>" },
      { referenceName: "Microsoft.VSTS.Common.Priority", label: "Priority", value: "1" },
      { referenceName: "System.Tags", label: "Tags", value: "a; b" },
      { referenceName: "Custom.Team", label: "Team", value: "Core" },
    ];
    expect(stagedChangesFromPresetFields(fields, makePreview())).toEqual({
      assignee: {
        assignValue: "Alice <alice@corp.com>",
        displayName: "Alice <alice@corp.com>",
      },
      priority: 1,
      tags: ["a", "b"],
      fields: { "Custom.Team": { label: "Team", value: "Core" } },
    });
  });

  it("ignores an unparsable priority value", () => {
    const fields = [
      { referenceName: "Microsoft.VSTS.Common.Priority", label: "Priority", value: "high" },
    ];
    expect(stagedChangesFromPresetFields(fields, makePreview())).toEqual({});
  });
});
