import { describe, expect, it } from "vitest";
import { generateReleaseNotes } from "@/lib/azdoCommands";
import { generateReleaseNotesMarkdown } from "./releaseNotes";

// Exercises the generate_release_notes wrapper + Zod schema + demo branch, then
// the markdown generator, via the browser-demo path.
describe("generateReleaseNotes (demo runtime)", () => {
  it("returns completed PRs that render into grouped markdown", async () => {
    const prs = await generateReleaseNotes({
      organizationId: "contoso",
      projectId: "platform",
    });
    expect(prs.length).toBeGreaterThan(0);
    const md = generateReleaseNotesMarkdown(prs);
    expect(md).toContain("# Release notes");
    expect(md).toContain("## api-gateway");
    expect(md).toMatch(/\(#\d+\)/);
  });
});
