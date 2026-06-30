import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type CommitSummary } from "@/lib/azdoCommands";
import { CommitPreviewPanel } from "./CommitPreviewPanel";

const navigateToWorkItem = vi.hoisted(() => vi.fn());
vi.mock("@/lib/crossLinks", () => ({ navigateToWorkItem }));

// The files panel fetches its own changed-file/diff data; stub it out so this
// suite stays focused on the related-PR and linked-work-item panels above it.
vi.mock("./CommitFilesPanel", () => ({ CommitFilesPanel: () => null }));

// Matches the demo commit the dispatchExt fixtures associate with both a
// related PR and a linked work item (see `demoCommitPullRequests` /
// `demoCommitWorkItems` in `src/lib/demo/commits.ts`).
const commitWithLinks: CommitSummary = {
  organizationId: "contoso",
  projectId: "platform",
  projectName: "Platform",
  repositoryId: "azdo-dashboard",
  repositoryName: "azdo-dashboard",
  commitId: "abcdef1234567890abcdef1234567890abcdef12",
  shortCommitId: "abcdef12",
  comment: "Add commit search dashboard with grid view and keyboard nav",
  authorName: "Demo User",
  authorEmail: "demo@example.com",
  authorDate: "2026-05-27T08:00:00Z",
  webUrl:
    "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/commit/abcdef1234567890abcdef1234567890abcdef12",
};

function renderPreview(commit: CommitSummary | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommitPreviewPanel
        commit={commit}
        maximized={false}
        onToggleMaximize={() => {}}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("CommitPreviewPanel linked work items", () => {
  it(
    "lists linked work items and navigates to one on click",
    async () => {
      navigateToWorkItem.mockClear();
      renderPreview(commitWithLinks);

      // The button's accessible name comes from its visible text (id + title +
      // badges), not the `title` attribute, since visible text takes priority.
      const workItemButton = await screen.findByRole(
        "button",
        { name: /track commit search dashboard delivery/i },
        { timeout: 8000 },
      );
      expect(workItemButton.textContent).toMatch(/#501/);

      fireEvent.click(workItemButton);
      expect(navigateToWorkItem).toHaveBeenCalledWith({
        organizationId: "contoso",
        workItemId: 501,
      });
    },
    15000,
  );

  it("renders nothing for a commit with no linked work items", async () => {
    renderPreview({ ...commitWithLinks, commitId: "no-links-commit" });

    // Wait for the (empty) work-items query to settle before asserting the
    // section never appears.
    await waitFor(() => expect(screen.queryByText(/loading linked work items/i)).toBeNull(), {
      timeout: 8000,
    });
    expect(screen.queryByText(/linked work item/i)).toBeNull();
  });
});
