import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { PrReviewPanel } from "./PrReviewPanel";

const pr: ReviewPullRequestSummary = {
  organizationId: "contoso",
  projectId: "project-1",
  projectName: "Platform",
  repositoryId: "repo-1",
  repositoryName: "azdo-dashboard",
  pullRequestId: 999,
  title: "Test PR",
  createdBy: "Author",
  creationDate: "2026-06-14T00:00:00Z",
  targetRefName: "main",
  webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/999",
  myVote: 0,
  myVoteLabel: "No vote",
  myIsRequired: false,
  isDraft: false,
  mergeStatus: null,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrReviewPanel selectedPr={pr} />
    </QueryClientProvider>,
  );
}

describe("PrReviewPanel status actions", () => {
  it(
    "renders Complete and Abandon actions for an active PR",
    async () => {
      renderPanel();
      expect(
        await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Abandon" })).toBeTruthy();
    },
    15000,
  );
});
