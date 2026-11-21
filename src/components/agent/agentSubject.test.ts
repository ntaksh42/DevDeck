import { describe, expect, it } from "vitest";
import { contextIsAbout, contextLine, type AgentSubject } from "./agentSubject";

const run: AgentSubject = {
  kind: "pipeline-run",
  id: 2,
  title: "2 (CI, succeeded)",
  projectId: "p",
  webUrl: "https://dev.azure.com/o/p/_build/results?buildId=2",
};

describe("contextIsAbout", () => {
  it("matches a run by URL even after its label changed", () => {
    const asked = contextLine({ ...run, title: "2 (CI, inProgress)" });
    expect(contextIsAbout(asked, run)).toBe(true);
    expect(contextIsAbout(asked, { ...run, id: 3, webUrl: "https://dev.azure.com/o/p/_build/results?buildId=3" })).toBe(false);
  });

  it("matches a subject without a URL by its context line", () => {
    const withoutUrl: AgentSubject = { ...run, webUrl: null };
    expect(contextIsAbout(contextLine(withoutUrl), withoutUrl)).toBe(true);
    expect(contextIsAbout("This list (3)", withoutUrl)).toBe(false);
  });

  it("keeps requests without a subject apart from requests about one", () => {
    expect(contextIsAbout(null, null)).toBe(true);
    expect(contextIsAbout("This list (3)", null)).toBe(true);
    expect(contextIsAbout(contextLine(run), null)).toBe(false);
    expect(contextIsAbout("Analyze group · Release blockers", null)).toBe(false);
  });
});
