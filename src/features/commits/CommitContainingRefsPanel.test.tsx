import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/azdoCommands";

const getCommitContainingRefs = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  getCommitContainingRefs: (...args: unknown[]) => getCommitContainingRefs(...args),
}));

import { CommitContainingRefsPanel } from "./CommitContainingRefsPanel";

const commit: CommitSummary = {
  organizationId: "contoso",
  projectId: "p1",
  projectName: "Platform",
  repositoryId: "r1",
  repositoryName: "repo",
  commitId: "abcdef1234567890abcdef1234567890abcdef12",
  shortCommitId: "abcdef12",
  comment: "msg",
  authorName: "Alice",
  authorEmail: null,
  authorDate: null,
  webUrl: null,
};

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommitContainingRefsPanel commit={commit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => getCommitContainingRefs.mockReset());
afterEach(cleanup);

describe("CommitContainingRefsPanel", () => {
  it("lists the containing branches and tags", async () => {
    getCommitContainingRefs.mockResolvedValue({
      branches: ["main", "release/1.x"],
      tags: ["v1.0"],
      checked: 3,
      total: 3,
    });
    renderPanel();

    expect(await screen.findByText("main")).toBeTruthy();
    expect(screen.getByText("release/1.x")).toBeTruthy();
    expect(screen.getByText("v1.0")).toBeTruthy();
    expect(screen.queryByText(/Checked \d+ of \d+/)).toBeNull();
  });

  it("says when only some of the refs were checked", async () => {
    getCommitContainingRefs.mockResolvedValue({ branches: [], tags: [], checked: 50, total: 120 });
    renderPanel();

    expect(await screen.findByText(/No checked branch or tag contains this commit/)).toBeTruthy();
    expect(screen.getByText("Checked 50 of 120 branches and tags; others may also contain it.")).toBeTruthy();
  });

  it("renders nothing when the lookup has no result to show", async () => {
    // A failed lookup (e.g. GitHub, "not supported") leaves the query without
    // data, which takes this same branch.
    getCommitContainingRefs.mockResolvedValue(null);
    const { container } = renderPanel();

    await vi.waitFor(() => expect(getCommitContainingRefs).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.textContent).toBe(""));
  });
});
