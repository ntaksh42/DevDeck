import { describe, expect, it } from "vitest";
import type { ReleaseNotePr } from "@/lib/azdoCommands";
import { generateReleaseNotesMarkdown } from "./releaseNotes";

function pr(overrides: Partial<ReleaseNotePr>): ReleaseNotePr {
  return {
    pullRequestId: 1,
    title: "Change",
    createdBy: "Alice",
    closedDate: "2026-06-10T00:00:00Z",
    repositoryName: "repo-a",
    targetRefName: "main",
    webUrl: null,
    ...overrides,
  };
}

describe("generateReleaseNotesMarkdown", () => {
  it("reports an empty range", () => {
    expect(generateReleaseNotesMarkdown([])).toContain("No completed pull requests");
  });

  it("groups PRs by repository with title, id, and author", () => {
    const md = generateReleaseNotesMarkdown([
      pr({ pullRequestId: 10, title: "Add cache", repositoryName: "repo-b", createdBy: "Bob" }),
      pr({ pullRequestId: 11, title: "Fix bug", repositoryName: "repo-a", createdBy: "Alice" }),
    ]);
    // Repos are sorted alphabetically.
    expect(md.indexOf("## repo-a")).toBeLessThan(md.indexOf("## repo-b"));
    expect(md).toContain("- Fix bug (#11) (@Alice)");
    expect(md).toContain("- Add cache (#10) (@Bob)");
  });

  it("includes the date range when provided and omits a missing author", () => {
    const md = generateReleaseNotesMarkdown(
      [pr({ pullRequestId: 5, title: "Tidy", createdBy: null })],
      { fromDate: "2026-06-01", toDate: "2026-06-30" },
    );
    expect(md).toContain("_2026-06-01 – 2026-06-30_");
    expect(md).toContain("- Tidy (#5)");
    expect(md).not.toContain("(@");
  });
});
