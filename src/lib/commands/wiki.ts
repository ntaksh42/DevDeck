import { z } from "zod";
import { invokeCommand } from "./runtime";

const wikiSearchHitSchema = z.object({
  fileName: z.string(),
  pagePath: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  wikiId: z.string(),
  wikiName: z.string(),
  webUrl: z.string(),
});
const wikiSearchResultsSchema = z.object({
  count: z.number(),
  results: z.array(wikiSearchHitSchema),
  notice: z.string().nullable(),
});
export type WikiSearchHit = z.infer<typeof wikiSearchHitSchema>;
export type WikiSearchResults = z.infer<typeof wikiSearchResultsSchema>;

export async function searchWiki(input: {
  organizationId?: string;
  query: string;
  /** Page size; the backend defaults this when omitted. */
  top?: number;
  /** Number of leading results to skip, for "load more" paging. */
  skip?: number;
}): Promise<WikiSearchResults> {
  const result = await invokeCommand("search_wiki", { input });
  return wikiSearchResultsSchema.parse(result);
}

const wikiPageSchema = z.object({
  pagePath: z.string(),
  content: z.string(),
  webUrl: z.string(),
});
export type WikiPage = z.infer<typeof wikiPageSchema>;

export async function getWikiPage(input: {
  organizationId?: string;
  projectId: string;
  projectName: string;
  wikiId: string;
  wikiName: string;
  pagePath: string;
}): Promise<WikiPage> {
  const result = await invokeCommand("get_wiki_page", { input });
  return wikiPageSchema.parse(result);
}
