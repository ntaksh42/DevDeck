import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { LinkedWorkItemsPanel } from "./LinkedWorkItemsPanel";

afterEach(cleanup);

const pr: ReviewPullRequestSummary = {
  organizationId: "contoso",
  projectId: "project-1",
  projectName: "Platform",
  repositoryId: "repo-1",
  repositoryName: "azdo-dashboard",
  pullRequestId: 101,
  title: "Test PR",
  createdBy: "Author",
  creationDate: "2026-06-14T00:00:00Z",
  targetRefName: "main",
  webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/101",
  myVote: 0,
  myVoteLabel: "No vote",
  myIsRequired: false,
  isDraft: false,
  mergeStatus: null,
  ciStatus: null,
  ciContext: null,
  ciCheckCount: 0,
};

describe("LinkedWorkItemsPanel", () => {
  it("lets the user pick between multiple linked work items with the arrow keys", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LinkedWorkItemsPanel pr={pr} />
      </QueryClientProvider>,
    );
    // Demo API links 123 and 118; the demo description also mentions AB#187.
    const group = await screen.findByRole("radiogroup", { name: "Linked work items" });
    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(3);
    // Sorted by id: 118 first, selected by default.
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getAllByRole("radio")[1].getAttribute("aria-checked")).toBe("true"),
    );
  });
});
