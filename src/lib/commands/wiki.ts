import { z } from "zod";
import { invokeCommand } from "./runtime";

const wikiSearchHitSchema = z.object({
  fileName: z.string(),
  path: z.string(),
  projectName: z.string(),
  wikiId: z.string(),
  wikiName: z.string(),
  webUrl: z.string(),
  snippet: z.string().nullable(),
});
const wikiSearchResultsSchema = z.object({
  count: z.number(),
  results: z.array(wikiSearchHitSchema),
  notice: z.string().nullable(),
});
export type WikiSearchHit = z.infer<typeof wikiSearchHitSchema>;
export type WikiSearchResults = z.infer<typeof wikiSearchResultsSchema>;

// Keyword search across wiki pages in the organization (optionally scoped to a
// set of projects). Azure DevOps only; gated by `capabilities.wiki`.
export async function searchWikiPages(input: {
  organizationId?: string;
  query: string;
  projects?: string[];
}): Promise<WikiSearchResults> {
  const result = await invokeCommand("search_wiki_pages", { input });
  return wikiSearchResultsSchema.parse(result);
}

const wikiPageContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  webUrl: z.string(),
});
export type WikiPageContent = z.infer<typeof wikiPageContentSchema>;

// Fetches a wiki page's Markdown content for the preview pane.
export async function getWikiPage(input: {
  organizationId?: string;
  project: string;
  wikiId: string;
  path: string;
}): Promise<WikiPageContent> {
  const result = await invokeCommand("get_wiki_page", { input });
  return wikiPageContentSchema.parse(result);
}
