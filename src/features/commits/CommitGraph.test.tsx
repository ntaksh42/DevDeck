import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/azdoCommands";
import { CommitGraph } from "./CommitGraph";

const getCommitParents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/azdoCommands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/azdoCommands")>("@/lib/azdoCommands");
  return { ...actual, getCommitParents };
});

function commit(overrides: Partial<CommitSummary>): CommitSummary {
  return {
    organizationId: "contoso",
    projectId: "platform",
    projectName: "Platform",
    repositoryId: "repo-1",
    repositoryName: "Repo",
    commitId: "c1",
    shortCommitId: "c1",
    comment: "message",
    authorName: "Dev",
    authorEmail: "dev@example.com",
    authorDate: "2026-06-01T00:00:00Z",
    webUrl: null,
    ...overrides,
  };
}

function renderGraph(results: CommitSummary[], loading = false, searched = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitGraph loading={loading} results={results} searched={searched} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  getCommitParents.mockReset();
});

describe("CommitGraph", () => {
  it("renders a row per commit once parents resolve, fetching parents for the whole result set", async () => {
    getCommitParents.mockResolvedValue([
      { commitId: "c2", parentIds: ["c1"] },
      { commitId: "c1", parentIds: [] },
    ]);
    renderGraph([
      commit({ commitId: "c2", shortCommitId: "c2", comment: "second commit" }),
      commit({ commitId: "c1", shortCommitId: "c1", comment: "first commit" }),
    ]);

    expect(await screen.findByText("second commit")).toBeTruthy();
    expect(screen.getByText("first commit")).toBeTruthy();
    expect(getCommitParents).toHaveBeenCalledWith({
      organizationId: "contoso",
      projectId: "platform",
      repositoryId: "repo-1",
      commitIds: ["c2", "c1"],
    });
  });

  it("asks to narrow to a single repository when results span more than one", async () => {
    renderGraph([
      commit({ commitId: "c1", repositoryId: "repo-1" }),
      commit({ commitId: "c2", repositoryId: "repo-2" }),
    ]);

    expect(
      await screen.findByText(/select a single repository to view the commit graph/i),
    ).toBeTruthy();
    expect(getCommitParents).not.toHaveBeenCalled();
  });

  it("shows an empty state when the search returned no results", () => {
    renderGraph([]);
    expect(screen.getByText("No commits matched.")).toBeTruthy();
    expect(getCommitParents).not.toHaveBeenCalled();
  });

  it("prompts to run a search before any query has completed", () => {
    renderGraph([], false, false);
    expect(screen.getByText("Run a search to load the commit graph.")).toBeTruthy();
  });
});
