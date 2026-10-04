import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommitSummary } from "@/lib/azdoCommands";
import { CommitPreviewPanel } from "./CommitPreviewPanel";

afterEach(cleanup);

const base: CommitSummary = {
  organizationId: "contoso",
  projectId: "p1",
  projectName: "Platform",
  repositoryId: "r1",
  repositoryName: "repo",
  commitId: "abcdef1234567890abcdef1234567890abcdef12",
  shortCommitId: "abcdef12",
  comment: "Rebased change",
  authorName: "Alice",
  authorEmail: "alice@x.com",
  authorDate: "2026-06-01T00:00:00Z",
  webUrl: null,
};

function renderPanel(commit: CommitSummary) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommitPreviewPanel commit={commit} maximized={false} onToggleMaximize={() => {}} />
    </QueryClientProvider>,
  );
}

describe("CommitPreviewPanel identity", () => {
  it("shows the date with a relative suffix and no committer row when they match", () => {
    renderPanel({
      ...base,
      committerName: "Alice",
      committerEmail: "alice@x.com",
      committerDate: "2026-06-01T00:00:00Z",
    });
    expect(screen.queryByText("Committer")).toBeNull();
    expect(screen.getByText(/\(.*ago\)|\(just now\)|\(yesterday\)/i)).toBeTruthy();
  });

  it("shows the committer when someone other than the author applied the commit", () => {
    renderPanel({
      ...base,
      committerName: "Bob",
      committerEmail: "bob@x.com",
      committerDate: "2026-06-02T00:00:00Z",
    });
    expect(screen.getByText("Committer")).toBeTruthy();
    expect(screen.getByText(/Bob <bob@x\.com>/)).toBeTruthy();
  });
});
