import { z } from "zod";
import { invokeCommand } from "./runtime";
import { workItemSummariesSchema } from "./workItems";
import { pullRequestSummariesSchema } from "./prs";
import { commitSummariesSchema } from "./commits";

const searchAllResultSchema = z.object({
  workItems: workItemSummariesSchema,
  pullRequests: pullRequestSummariesSchema,
  commits: commitSummariesSchema,
  totals: z.object({
    workItems: z.number(),
    pullRequests: z.number(),
    commits: z.number(),
  }),
});

export type SearchAllResult = z.infer<typeof searchAllResultSchema>;

export type SearchAllInput = {
  organizationId?: string;
  query: string;
  limitPerKind?: number;
};

export async function searchAll(input: SearchAllInput): Promise<SearchAllResult> {
  const result = await invokeCommand("search_all", { input });
  return searchAllResultSchema.parse(result);
}
