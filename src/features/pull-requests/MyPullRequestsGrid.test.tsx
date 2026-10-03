import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyCreatedPullRequestSummary } from "@/lib/azdoCommands";
import { MyPullRequestsGrid } from "./MyPullRequestsGrid";

afterEach(cleanup);

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  window.localStorage.clear();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

const pr: MyCreatedPullRequestSummary = {
  organizationId: "contoso",
  projectId: "project-1",
  projectName: "Platform",
  repositoryId: "repo-1",
  repositoryName: "azdo-dashboard",
  pullRequestId: 77,
  title: "Add [draft] toggle",
  creationDate: "2026-06-14T00:00:00Z",
  sourceRefName: "refs/heads/feature/x",
  targetRefName: "refs/heads/main",
  webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/77",
  isDraft: false,
  approvals: 0,
  reviewerCount: 0,
};

describe("MyPullRequestsGrid copy shortcuts", () => {
  it("copies the selected PR as a Markdown link with L", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["activeOrganization"], { id: "contoso" });
    client.setQueryData(["myCreatedPullRequests", "contoso"], [pr]);
    render(
      <QueryClientProvider client={client}>
        <MyPullRequestsGrid />
      </QueryClientProvider>,
    );

    const grid = await screen.findByRole("grid", { name: "My pull requests" });
    fireEvent.keyDown(grid, { key: "l" });

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "[!77 Add draft toggle](https://dev.azure.com/contoso/project/_git/repo/pullrequest/77)",
      ),
    );
    expect(await screen.findByText("Markdown link copied")).toBeTruthy();
  });
});
