import { describe, expect, it } from "vitest";
import { updateWorkItemComment } from "@/lib/azdoCommands";

// Runs against the browser demo path (no Tauri runtime), exercising the
// update_work_item_comment wrapper + Zod schema + demo branch end to end.
describe("updateWorkItemComment (demo runtime)", () => {
  it("returns the edited comment, preserving the comment id", async () => {
    const updated = await updateWorkItemComment({
      organizationId: "contoso",
      projectId: "demo-project",
      workItemId: 1,
      commentId: 4242,
      markdown: "edited in a test",
    });

    expect(updated.id).toBe(4242);
    expect(updated.text).toBe("edited in a test");
    expect(updated.renderedText).toContain("edited in a test");
  });
});
