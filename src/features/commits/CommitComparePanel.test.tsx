import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitFileDiff, CommitRangeChangeSet, CommitSummary } from "@/lib/azdoCommands";
import { CommitComparePanel } from "./CommitComparePanel";

const getCommitRangeChanges = vi.fn();
const getCommitFileDiff = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    getCommitRangeChanges: (...args: unknown[]) => getCommitRangeChanges(...args),
    getCommitFileDiff: (...args: unknown[]) => getCommitFileDiff(...args),
  };
});

afterEach(() => {
  cleanup();
  getCommitRangeChanges.mockReset();
  getCommitFileDiff.mockReset();
});

function commit(overrides: Partial<CommitSummary>): CommitSummary {
  return {
    organizationId: "contoso",
    projectId: "proj-1",
    projectName: "Platform",
    repositoryId: "repo-1",
    repositoryName: "Repo",
    commitId: "base-sha",
    shortCommitId: "base-sh",
    comment: "A commit",
    authorName: null,
    authorEmail: null,
    authorDate: null,
    webUrl: null,
    ...overrides,
  };
}

function renderPanel(base: CommitSummary, target: CommitSummary) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitComparePanel
        base={base}
        target={target}
        maximized={false}
        onToggleMaximize={() => {}}
        onClear={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("CommitComparePanel", () => {
  it("lists changed files between the two commits and keeps base/target orientation when fetching a file diff", async () => {
    const base = commit({ commitId: "base-sha", shortCommitId: "base-sh" });
    const target = commit({ commitId: "target-sha", shortCommitId: "target-s" });
    const rangeChanges: CommitRangeChangeSet = {
      baseCommitId: "base-sha",
      targetCommitId: "target-sha",
      files: [
        { path: "/src/new_file.rs", changeType: "add", originalPath: null },
        { path: "/src/old_file.rs", changeType: "delete", originalPath: null },
      ],
    };
    getCommitRangeChanges.mockResolvedValue(rangeChanges);
    const diff: CommitFileDiff = {
      filePath: "/src/new_file.rs",
      baseContent: null,
      targetContent: "fn main() {}\n",
      baseUnavailableReason: "missing",
      targetUnavailableReason: null,
    };
    getCommitFileDiff.mockResolvedValue(diff);

    renderPanel(base, target);

    await waitFor(() => {
      expect(getCommitRangeChanges).toHaveBeenCalledWith(
        expect.objectContaining({ baseCommitId: "base-sha", targetCommitId: "target-sha" }),
      );
    });
    const fileButton = await screen.findByText("new_file.rs");
    fireEvent.click(fileButton);

    await waitFor(() => {
      expect(getCommitFileDiff).toHaveBeenCalled();
    });
    // The compare panel reuses the single-commit diff command for arbitrary
    // commit pairs; base must map to parentCommitId and target to commitId,
    // never swapped, or added/deleted files render on the wrong side.
    expect(getCommitFileDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        commitId: "target-sha",
        parentCommitId: "base-sha",
        filePath: "/src/new_file.rs",
        changeType: "add",
      }),
    );
    expect(await screen.findByText(/fn main/)).toBeTruthy();
  });

  it("shows a message instead of calling the API when the commits are from different repositories", async () => {
    const base = commit({ repositoryId: "repo-1" });
    const target = commit({ repositoryId: "repo-2" });

    renderPanel(base, target);

    expect(
      await screen.findByText(/select two commits from the same repository/i),
    ).toBeTruthy();
    expect(getCommitRangeChanges).not.toHaveBeenCalled();
  });
});
