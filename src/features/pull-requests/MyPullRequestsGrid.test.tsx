import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyCreatedPullRequestSummary } from "@/lib/azdoCommands";
import { useAgentListScope } from "@/components/agent/agentListScope";
import { useAgentSubject } from "@/components/agent/agentSubject";
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
  mergeStatus: null,
};

describe("MyPullRequestsGrid copy shortcuts", () => {
  it("shows a project warning while keeping successful PRs usable", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["activeOrganization"], { id: "contoso" });
    client.setQueryData(["myCreatedPullRequests", "contoso"], {
      pullRequests: [pr],
      warnings: ["Restricted"],
    });
    render(
      <QueryClientProvider client={client}>
        <MyPullRequestsGrid />
      </QueryClientProvider>,
    );

    const grid = await screen.findByRole("grid", { name: "My pull requests" });
    expect(screen.getByText("Could not fetch 1 project(s): Restricted.")).toBeTruthy();
    expect(within(grid).getByText(pr.title)).toBeTruthy();
    fireEvent.keyDown(grid, { key: "l" });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("!77")));
  });

  it("marks a PR with merge conflicts next to its title", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["activeOrganization"], { id: "contoso" });
    client.setQueryData(["myCreatedPullRequests", "contoso"], {
      pullRequests: [pr, { ...pr, pullRequestId: 78, title: "Conflicted", mergeStatus: "conflicts" }],
      warnings: [],
    });
    render(
      <QueryClientProvider client={client}>
        <MyPullRequestsGrid />
      </QueryClientProvider>,
    );

    const grid = await screen.findByRole("grid", { name: "My pull requests" });
    expect(within(grid).getAllByText("Conflicts")).toHaveLength(1);
  });

  it("copies the selected PR as a Markdown link with L", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["activeOrganization"], { id: "contoso" });
    client.setQueryData(["myCreatedPullRequests", "contoso"], { pullRequests: [pr], warnings: [] });
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

  it("opens the folded filter with / like Ctrl+F", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["activeOrganization"], { id: "contoso" });
    client.setQueryData(["myCreatedPullRequests", "contoso"], { pullRequests: [pr], warnings: [] });
    render(
      <QueryClientProvider client={client}>
        <MyPullRequestsGrid />
      </QueryClientProvider>,
    );

    const grid = await screen.findByRole("grid", { name: "My pull requests" });
    expect(screen.queryByRole("combobox", { name: "Filter pull requests" })).toBeNull();
    fireEvent.keyDown(grid, { key: "/" });

    expect(document.activeElement).toBe(await screen.findByRole("combobox", { name: "Filter pull requests" }));
  });

  it("hides draft PRs with the always-visible Show Drafts checkbox", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["activeOrganization"], { id: "contoso" });
    const draft = { ...pr, pullRequestId: 78, title: "WIP refactor", isDraft: true };
    client.setQueryData(["myCreatedPullRequests", "contoso"], { pullRequests: [pr, draft], warnings: [] });
    render(
      <QueryClientProvider client={client}>
        <MyPullRequestsGrid />
      </QueryClientProvider>,
    );

    const grid = await screen.findByRole("grid", { name: "My pull requests" });
    expect(within(grid).getByText("WIP refactor")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Drafts (1)" }));
    expect(within(grid).queryByText("WIP refactor")).toBeNull();
    expect(within(grid).getByText(pr.title)).toBeTruthy();
    expect(screen.getByText("1 of 2 items")).toBeTruthy();
  });

  it("offers the visible list and the selected PR to the Agent panel", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["activeOrganization"], { id: "contoso" });
    const draft = { ...pr, pullRequestId: 78, title: "WIP refactor", isDraft: true };
    client.setQueryData(["myCreatedPullRequests", "contoso"], { pullRequests: [pr, draft], warnings: [] });
    function Probe() {
      const scope = useAgentListScope();
      const subject = useAgentSubject();
      return (
        <>
          <output data-testid="scope">{scope ? `${scope.id}:${scope.count}` : ""}</output>
          <output data-testid="subject">{subject && subject.kind === "pull-request" ? `${subject.kind}:${subject.id}` : ""}</output>
          <output data-testid="markdown">{scope?.markdown() ?? ""}</output>
        </>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
        <MyPullRequestsGrid />
      </QueryClientProvider>,
    );

    await screen.findByRole("grid", { name: "My pull requests" });
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("my-pull-requests:2"));
    expect(screen.getByTestId("subject").textContent).toBe("pull-request:77");
    expect(screen.getByTestId("markdown").textContent).toContain("| !78 | WIP refactor |");

    fireEvent.click(screen.getByRole("checkbox", { name: "Show Drafts (1)" }));
    await waitFor(() => expect(screen.getByTestId("scope").textContent).toBe("my-pull-requests:1"));
  });
});
