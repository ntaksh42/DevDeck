import { describe, expect, it } from "vitest";
import { contextIsAbout, contextLine, type AgentSubject } from "./agentSubject";

const run: AgentSubject = {
  kind: "pipeline-run",
  id: 2,
  title: "2 (CI, succeeded)",
  projectId: "p",
  webUrl: "https://dev.azure.com/o/p/_build/results?buildId=2",
};
const group: AgentSubject = { kind: "analyze-group", id: "g1", title: "Release blockers", webUrl: null };

describe("contextIsAbout", () => {
  it("matches a run by URL even after its label changed", () => {
    const asked = contextLine({ ...run, title: "2 (CI, inProgress)" });
    expect(contextIsAbout(asked, run)).toBe(true);
    expect(contextIsAbout(asked, { ...run, id: 3, webUrl: "https://dev.azure.com/o/p/_build/results?buildId=3" })).toBe(false);
  });

  it("matches a subject without a URL by its context line", () => {
    expect(contextIsAbout(contextLine(group), group)).toBe(true);
    expect(contextIsAbout(contextLine(run), group)).toBe(false);
  });

  it("keeps requests without a subject apart from requests about one", () => {
    expect(contextIsAbout(null, null)).toBe(true);
    expect(contextIsAbout("This list (3)", null)).toBe(true);
    expect(contextIsAbout(contextLine(run), null)).toBe(false);
  });
});
