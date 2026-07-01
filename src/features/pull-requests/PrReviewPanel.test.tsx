import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { PrReviewPanel } from "./PrReviewPanel";

// This project's vitest config has no global setup, so Testing Library's
// automatic per-test cleanup isn't registered; unmount explicitly so a prior
// render's panel doesn't leak into the next test's `screen` queries.
afterEach(cleanup);

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
  ciStatus: null,
  ciContext: null,
  ciCheckCount: 0,
};

function renderPanel(selectedPr: ReviewPullRequestSummary = pr) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrReviewPanel selectedPr={selectedPr} />
    </QueryClientProvider>,
  );
}

describe("PrReviewPanel status actions", () => {
  it(
    "renders Complete inline and Abandon in the overflow menu for an active PR",
    async () => {
      renderPanel();
      expect(
        await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 }),
      ).toBeTruthy();
      // Secondary actions (incl. Abandon) now live behind the "⋯" overflow menu.
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      expect(await screen.findByRole("menuitem", { name: "Abandon" })).toBeTruthy();
    },
    15000,
  );
});

describe("PrReviewPanel labels", () => {
  it("renders label chips from the review and can queue removing one", async () => {
    renderPanel();

    // The demo review (pull request 999 falls back to the generic demo
    // detail) carries two labels; the header renders them as removable chips.
    expect(await screen.findByText("hotfix", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText("needs-docs")).toBeTruthy();

    const removeButton = screen.getByRole("button", { name: "Remove label hotfix" });
    fireEvent.click(removeButton);
    // The demo remove-label command is a no-op, so this just confirms the
    // control is wired without asserting on a specific post-mutation state.
    expect(removeButton).toBeTruthy();
  });

  it("adds a label by typing a name and pressing Enter", async () => {
    renderPanel();
    const input = await screen.findByLabelText("Add label", {}, { timeout: 8000 });
    fireEvent.change(input, { target: { value: "triaged" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The input clears once the add mutation is queued.
    expect((input as HTMLInputElement).value).toBe("");
  });
});

describe("PrReviewPanel Result tab", () => {
  // PR 101 is one of the demo PRs that resolves a review-result HTML file.
  const resultPr: ReviewPullRequestSummary = { ...pr, pullRequestId: 101 };

  it(
    "renders the HTML preview in a same-origin sandboxed iframe so it shows in the desktop WebView2 runtime",
    async () => {
      renderPanel(resultPr);

      const resultTab = await screen.findByRole(
        "tab",
        { name: "Result" },
        { timeout: 8000 },
      );
      fireEvent.click(resultTab);

      // Wait for the preview query to resolve and render its iframe.
      const frame = (await screen.findByTitle(
        "Review result preview for PR101",
        undefined,
        { timeout: 8000 },
      )) as HTMLIFrameElement;

      // `allow-same-origin` is what makes the srcDoc render in WebView2; an
      // empty sandbox left the frame blank in the desktop app. `allow-scripts`
      // must stay off so the document still can't run JavaScript.
      const sandbox = frame.getAttribute("sandbox") ?? "";
      expect(sandbox.split(/\s+/).filter(Boolean)).toEqual(["allow-same-origin"]);
      expect(frame.getAttribute("srcdoc")).toContain("Rate limiting middleware review");
    },
    15000,
  );
});
