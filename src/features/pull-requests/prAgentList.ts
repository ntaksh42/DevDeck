import { listMarkdown, type AgentListScope } from "@/components/agent/agentListScope";

// The pull request list a grid shows, as the Agent panel's optional "This list"
// context: the visible rows (after the active filters) as a Markdown table.

type ListedPr = {
  pullRequestId: number;
  title: string;
  repositoryName: string;
  createdBy?: string | null;
  targetRefName: string;
  creationDate: string;
  isDraft: boolean;
  /** Search results of any status; the other grids list active PRs only. */
  status?: string;
  /** My Reviews. */
  myVoteLabel?: string;
  /** My Pull Requests. */
  approvals?: number;
  reviewerCount?: number;
};

type Note = string | null | false | undefined;

/** `Column: a, b` lines for the active column filters (`Partial<Record<column, Set>>`). */
export function columnFilterNotes(filters: Partial<Record<string, Set<string>>>): string[] {
  return Object.entries(filters)
    .filter((entry): entry is [string, Set<string>] => !!entry[1] && entry[1].size > 0)
    .map(([column, values]) => `${column}: ${[...values].join(", ")}`);
}

export function prAgentList(id: string, title: string, prs: readonly ListedPr[], notes?: () => Note[]): AgentListScope {
  return {
    id,
    label: "This list",
    count: prs.length,
    markdown: () => {
      const first = prs[0];
      return listMarkdown({
        title,
        notes: notes?.().map((note) => note || null),
        headers: ["PR", "Title", "Repository", "Author", "Target", "State", first?.myVoteLabel !== undefined ? "My vote" : "Approvals", "Created"],
        rows: prs.map((pr) => [
          `!${pr.pullRequestId}`,
          pr.title,
          pr.repositoryName,
          pr.createdBy,
          pr.targetRefName.replace(/^refs\/heads\//, ""),
          [pr.status ?? "active", pr.isDraft ? "draft" : null].filter(Boolean).join(", "),
          pr.myVoteLabel ?? (pr.approvals !== undefined ? `${pr.approvals}/${pr.reviewerCount ?? 0}` : ""),
          pr.creationDate.slice(0, 10),
        ]),
      });
    },
  };
}

/** My Reviews' list scope: the visible (filtered, sorted) PRs plus the active filters. */
export function myReviewsAgentList(g: {
  sortedPrs: readonly ListedPr[];
  textFilter: string;
  columnFilters: Partial<Record<string, Set<string>>>;
  showDrafts: boolean;
  showDone: boolean;
}): AgentListScope {
  return prAgentList("my-reviews", "My Reviews", g.sortedPrs, () => [
    g.textFilter.trim() && `Text filter: ${g.textFilter.trim()}`,
    ...columnFilterNotes(g.columnFilters),
    !g.showDrafts && "Drafts hidden",
    g.showDone && "Showing archived (done) pull requests",
  ]);
}
