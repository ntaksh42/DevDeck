import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/azdoCommands";
import { CommitRefOperationDialog } from "./CommitRefOperationDialog";

const listRepoBranches = vi.hoisted(() => vi.fn());
const cherryPickCommit = vi.hoisted(() => vi.fn());
const revertCommit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/commands/code", () => ({
  listRepoBranches: (...args: unknown[]) => listRepoBranches(...args),
}));
vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    cherryPickCommit: (...args: unknown[]) => cherryPickCommit(...args),
    revertCommit: (...args: unknown[]) => revertCommit(...args),
  };
});

const commit: CommitSummary = {
  organizationId: "org-1",
  projectId: "project-1",
  projectName: "Project One",
  repositoryId: "repo-1",
  repositoryName: "repo-one",
  commitId: "abc123def456",
  shortCommitId: "abc123d",
  comment: "fix bug",
  authorName: "Alice",
  authorEmail: null,
  authorDate: "2026-06-01T00:00:00Z",
  webUrl: null,
};

function renderDialog(kind: "cherry-pick" | "revert", onClose = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitRefOperationDialog kind={kind} commit={commit} onClose={onClose} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  listRepoBranches.mockReset();
  cherryPickCommit.mockReset();
  revertCommit.mockReset();
});

describe("CommitRefOperationDialog", () => {
  it("defaults to the repository's default branch and submits the operation", async () => {
    listRepoBranches.mockResolvedValue([
      { name: "main", isDefault: true },
      { name: "develop", isDefault: false },
    ]);
    cherryPickCommit.mockResolvedValue({
      status: "completed",
      newBranchName: "cherry-pick/abc123d",
      newBranchWebUrl: "https://dev.azure.com/contoso/proj/_git/repo?version=GBcherry-pick/abc123d",
      conflict: false,
      failureMessage: null,
    });

    renderDialog("cherry-pick");

    await waitFor(() => expect(screen.getByText(/Cherry-pick onto main/)).toBeTruthy());

    fireEvent.click(screen.getByText(/Cherry-pick onto main/));

    await waitFor(() => expect(cherryPickCommit).toHaveBeenCalledTimes(1));
    expect(cherryPickCommit.mock.calls[0][0]).toMatchObject({
      commitId: "abc123def456",
      ontoBranch: "main",
      newBranchName: "cherry-pick/abc123d",
    });
    expect(await screen.findByText(/succeeded/)).toBeTruthy();
  });

  it("surfaces a conflict result without treating it as a success", async () => {
    listRepoBranches.mockResolvedValue([{ name: "main", isDefault: true }]);
    revertCommit.mockResolvedValue({
      status: "failed",
      newBranchName: "revert/abc123d",
      newBranchWebUrl: null,
      conflict: true,
      failureMessage: null,
    });

    renderDialog("revert");

    await waitFor(() => expect(screen.getByText(/Revert onto main/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Revert onto main/));

    expect(await screen.findByText(/produced a conflict/)).toBeTruthy();
  });

  it("closes on Escape without submitting", async () => {
    listRepoBranches.mockResolvedValue([{ name: "main", isDefault: true }]);
    const onClose = vi.fn();
    renderDialog("cherry-pick", onClose);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cherryPickCommit).not.toHaveBeenCalled();
  });
});
