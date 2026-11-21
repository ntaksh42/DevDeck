import { describe, expect, it } from "vitest";
import type { WorkItemComment } from "@/lib/azdoCommands";
import { renderAzureMentionMarkdown } from "@/features/work-items/workItemMentions";
import { workItemReplyDraft } from "./InboxPreviewPanels";

function comment(overrides: Partial<WorkItemComment> = {}): WorkItemComment {
  return {
    id: 1,
    text: "<div>Could you check <b>the impact</b>\n on onboarding?</div>",
    renderedText: null,
    createdBy: "Frank Lee",
    createdById: "1b2c3d4e-0000-4000-8000-000000000001",
    createdByUniqueName: "frank@contoso.example",
    createdDate: null,
    ...overrides,
  };
}

describe("workItemReplyDraft", () => {
  it("quotes the comment as one plain line and mentions its author for real", () => {
    const draft = workItemReplyDraft(comment());
    expect(draft.text).toBe("> Could you check the impact on onboarding?\n\n@Frank Lee ");
    expect(renderAzureMentionMarkdown(`${draft.text}Done.`, draft.mentions)).toBe(
      "> Could you check the impact on onboarding?\n\n@<1b2c3d4e-0000-4000-8000-000000000001> Done.",
    );
  });

  it("shortens a long quote and leaves an unknown author unmentioned", () => {
    const draft = workItemReplyDraft(comment({ text: "x".repeat(200), createdBy: null, createdById: null }));
    expect(draft.text).toBe(`> ${"x".repeat(119)}…\n\n`);
    expect(draft.mentions).toEqual([]);
  });
});
