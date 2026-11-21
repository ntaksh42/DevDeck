import { describe, expect, it, vi } from "vitest";

const openExternalUrl = vi.fn();
vi.mock("@/lib/openExternal", () => ({ openExternalUrl: (url: string) => openExternalUrl(url) }));

import { paletteUrlItems, parsePaletteUrl } from "./paletteUrl";

const orgs = [
  { id: "org-1", baseUrl: "https://dev.azure.com/contoso" },
  { id: "org-2", baseUrl: "https://fabrikam.visualstudio.com" },
];

describe("parsePaletteUrl", () => {
  it.each([
    ["https://dev.azure.com/contoso/Web/_git/site/pullrequest/123", "pullRequest", 123, "org-1"],
    ["https://dev.azure.com/Contoso/My%20Project/_git/site/pullrequest/7/?_a=files", "pullRequest", 7, "org-1"],
    ["  https://dev.azure.com/contoso/Web/_workitems/edit/456/  ", "workItem", 456, "org-1"],
    ["https://dev.azure.com/contoso/_workitems/edit/9", "workItem", 9, "org-1"],
    ["https://dev.azure.com/contoso/Web/_boards/board/t/Team/Stories?workitem=42", "workItem", 42, "org-1"],
    ["https://dev.azure.com/contoso/Web/_build/results?buildId=789&view=logs", "pipelineRun", 789, "org-1"],
    ["https://fabrikam.visualstudio.com/Ops/_git/api/pullrequest/5", "pullRequest", 5, "org-2"],
    ["https://dev.azure.com/fabrikam/Ops/_workitems/edit/3", "workItem", 3, "org-2"],
  ])("reads %s", (text, kind, id, organizationId) => {
    expect(parsePaletteUrl(text, orgs)).toMatchObject({ kind, id, organizationId });
  });

  it("names an organization that is not registered", () => {
    expect(
      parsePaletteUrl("https://dev.azure.com/other/Web/_workitems/edit/1", orgs),
    ).toMatchObject({ kind: "workItem", organizationId: null, organizationName: "other" });
  });

  it.each([
    "pr:123",
    "123",
    "https://example.com/contoso/Web/_git/site/pullrequest/1",
    "https://dev.azure.com/contoso/Web/_git/site",
    "https://dev.azure.com/contoso/Web/_git/site/pullrequest/abc",
    "https://dev.azure.com/contoso/Web/_build?definitionId=4",
    "https://dev.azure.com/contoso/%E0%A4%A/_workitems/edit/1",
  ])("ignores %s", (text) => {
    expect(parsePaletteUrl(text, orgs)).toBeNull();
  });
});

describe("paletteUrlItems", () => {
  it("opens a pull request in DevDeck and in the browser with Ctrl+Enter", () => {
    const target = parsePaletteUrl("https://dev.azure.com/contoso/Web/_git/site/pullrequest/12", orgs)!;
    const openInApp = vi.fn();
    const [item] = paletteUrlItems(target, "org-1", openInApp);
    expect(item.label).toBe("Open pull request !12");
    item.run();
    expect(openInApp).toHaveBeenCalledWith("pullRequests", "12", "org-1");
    item.runAlt?.();
    expect(openExternalUrl).toHaveBeenCalledWith(target.url);
  });

  it("opens a work item in the work item search", () => {
    const target = parsePaletteUrl("https://dev.azure.com/contoso/Web/_workitems/edit/8", orgs)!;
    const openInApp = vi.fn();
    paletteUrlItems(target, "org-1", openInApp)[0].run();
    expect(openInApp).toHaveBeenCalledWith("workItems", "8", "org-1");
  });

  it("says when opening switches the active connection", () => {
    const target = parsePaletteUrl("https://fabrikam.visualstudio.com/Ops/_workitems/edit/3", orgs)!;
    const [item] = paletteUrlItems(target, "org-1", vi.fn());
    expect(item.detail).toBe("Switches the active connection to fabrikam");
  });

  it("only offers the browser for unregistered organizations and pipeline runs", () => {
    const openInApp = vi.fn();
    for (const text of [
      "https://dev.azure.com/other/Web/_workitems/edit/1",
      "https://dev.azure.com/contoso/Web/_build/results?buildId=3",
    ]) {
      const items = paletteUrlItems(parsePaletteUrl(text, orgs)!, "org-1", openInApp);
      expect(items).toHaveLength(1);
      items[0].run();
      expect(openExternalUrl).toHaveBeenLastCalledWith(text);
    }
    expect(openInApp).not.toHaveBeenCalled();
  });
});
