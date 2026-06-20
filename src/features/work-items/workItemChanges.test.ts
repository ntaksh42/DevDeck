import { describe, expect, it } from "vitest";
import type { WorkItemPreview } from "@/lib/azdoCommands";
import {
  DUPLICATE_TITLE_PREFIX,
  buildDuplicateDraft,
  buildInverseChanges,
  customPreviewFieldValue,
  stagedEntriesForPreview,
  type StagedChanges,
} from "./workItemChanges";

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
    ...overrides,
  };
}

describe("buildDuplicateDraft", () => {
  it("copies the duplicated fields and prefixes the title", () => {
    const preview = makePreview({
      title: "Fix login",
      workItemType: "Task",
      priority: "1",
      areaPath: "Platform\\Auth",
      iterationPath: "Platform\\Sprint 5",
      tags: "auth; security",
      assignedTo: "Jane Doe",
    });
    expect(buildDuplicateDraft(preview)).toEqual({
      organizationId: "contoso",
      projectId: "project-1",
      title: `${DUPLICATE_TITLE_PREFIX}Fix login`,
      workItemType: "Task",
      priority: "1",
      areaPath: "Platform\\Auth",
      iterationPath: "Platform\\Sprint 5",
      tags: ["auth", "security"],
      assignedTo: "Jane Doe",
    });
  });

  it("does not mutate the source preview", () => {
    const preview = makePreview({ title: "Original", tags: "alpha" });
    const snapshot = structuredClone(preview);
    buildDuplicateDraft(preview);
    expect(preview).toEqual(snapshot);
  });

  it("carries null fields through and normalizes empty tags", () => {
    const draft = buildDuplicateDraft(makePreview({ tags: "  ", areaPath: null }));
    expect(draft.tags).toEqual([]);
    expect(draft.areaPath).toBeNull();
  });
});

describe("customPreviewFieldValue", () => {
  it("matches the reference name case-insensitively", () => {
    const preview = makePreview({
      customFields: [{ referenceName: "Custom.Team", value: "Core" }],
    });
    expect(customPreviewFieldValue(preview, "custom.team")).toBe("Core");
  });

  it("returns null when the field is absent", () => {
    expect(customPreviewFieldValue(makePreview(), "Custom.Missing")).toBeNull();
  });
});

describe("buildInverseChanges", () => {
  it("restores the prior values for each staged field", () => {
    const preview = makePreview({
      state: "Active",
      assignedTo: "Alice <alice@corp.com>",
      priority: "2",
      reason: "Approved",
      tags: "alpha; beta",
      customFields: [{ referenceName: "Custom.Team", value: "Core" }],
    });
    const staged: StagedChanges = {
      state: "Resolved",
      assignee: { assignValue: "Bob <bob@corp.com>", displayName: "Bob" },
      priority: 1,
      reason: "Fixed",
      tags: ["gamma"],
      fields: { "Custom.Team": { label: "Team", value: "Platform" } },
    };

    expect(buildInverseChanges(preview, staged)).toEqual({
      state: "Active",
      assignee: { assignValue: "Alice <alice@corp.com>", displayName: "Alice <alice@corp.com>" },
      priority: 2,
      reason: "Approved",
      tags: ["alpha", "beta"],
      fields: { "Custom.Team": { label: "Team", value: "Core" } },
    });
  });

  it("uses Unassigned and empty value when prior assignee is missing", () => {
    const inverse = buildInverseChanges(makePreview({ assignedTo: null }), {
      assignee: { assignValue: "Bob <bob@corp.com>", displayName: "Bob" },
    });
    expect(inverse.assignee).toEqual({ assignValue: "", displayName: "Unassigned" });
  });

  it("skips priority when the prior value was never set", () => {
    const inverse = buildInverseChanges(makePreview({ priority: null }), { priority: 1 });
    expect(inverse.priority).toBeUndefined();
  });
});

describe("stagedEntriesForPreview", () => {
  it("returns no entries when there is no preview", () => {
    expect(stagedEntriesForPreview(null, { state: "Resolved" })).toEqual([]);
  });

  it("produces from/to rows for each staged change", () => {
    const preview = makePreview({ state: "Active", priority: "2", tags: "alpha" });
    const entries = stagedEntriesForPreview(preview, {
      state: "Resolved",
      priority: 1,
      tags: ["beta"],
    });

    expect(entries).toEqual([
      { key: "state", label: "State", from: "Active", to: "Resolved" },
      { key: "priority", label: "Priority", from: "2", to: "1" },
      { key: "tags", label: "Tags", from: "alpha", to: "beta" },
    ]);
  });

  it("falls back to an em dash for empty prior values", () => {
    const entries = stagedEntriesForPreview(makePreview({ tags: "  " }), { tags: [] });
    expect(entries).toEqual([{ key: "tags", label: "Tags", from: "—", to: "—" }]);
  });
});
