import { describe, expect, it } from "vitest";
import { getWikiPage, searchWiki } from "./wiki";

// Runs against the browser demo backend (no Tauri runtime in vitest), so this
// also checks the demo payloads satisfy the Zod schemas.
describe("wiki commands (demo runtime)", () => {
  it("finds pages by keyword and returns nothing for a blank query", async () => {
    const hits = await searchWiki({ query: "rollback" });
    expect(hits.results.map((hit) => hit.pagePath)).toEqual(["/Deploy Guide", "/Runbook"]);
    expect((await searchWiki({ query: "  " })).results).toEqual([]);
  });

  it("loads a page's Markdown body and browser link", async () => {
    const hit = (await searchWiki({ query: "deploy" })).results[0];
    const page = await getWikiPage({
      projectId: hit.projectId,
      projectName: hit.projectName,
      wikiId: hit.wikiId,
      wikiName: hit.wikiName,
      pagePath: hit.pagePath,
    });
    expect(page.content).toContain("# Deploy Guide");
    expect(page.webUrl).toBe(hit.webUrl);
  });
});
