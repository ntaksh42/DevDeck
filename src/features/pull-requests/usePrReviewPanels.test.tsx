import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { usePrReviewPanels } from "./usePrReviewPanels";

// This project's vitest config has no global setup, so Testing Library's
// automatic per-test cleanup isn't registered; unmount explicitly so a prior
// render's panel doesn't leak into the next test's `screen` queries.
afterEach(cleanup);

// The harness below renders a DockableWorkspace (storageKey
// "pr-review-harness-test"), which persists its dockview layout (incl. the
// active tab) to localStorage; clear it so one test's tab switch does not
// leak into the next test's render.
beforeEach(() => window.localStorage.clear());

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

// Mirrors how MyReviewsGrid/PrSearchResults actually embed these panels: the
// review tabs sit as flat siblings of a grid panel in one DockableWorkspace
// (usePrReviewPanels no longer nests a dockview of its own).
function PrReviewHarness({ selectedPr }: { selectedPr: ReviewPullRequestSummary | null }) {
  const { anchor, secondary } = usePrReviewPanels({ selectedPr });
  const panels: DockablePanelSpec[] = [
    { id: "grid", title: "Grid", content: <div>grid</div>, minWidth: 200 },
    {
      ...anchor,
      position: { relativeTo: "grid", direction: "right" },
      initialWidth: 600,
      minWidth: 300,
      maxWidth: 4096,
    },
    ...secondary,
  ];
  return <DockableWorkspace storageKey="pr-review-harness-test" panels={panels} />;
}

function renderPanel(selectedPr: ReviewPullRequestSummary = pr) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrReviewHarness selectedPr={selectedPr} />
    </QueryClientProvider>,
  );
}

describe("PrReviewPanel status actions", () => {
  it(
    "shows the Conversation tab alongside the PR metadata",
    async () => {
      renderPanel();
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });

      const metadata = screen.getByRole("group", { name: "Pull request metadata" });
      expect(metadata.textContent).toContain("Author");
      expect(metadata.textContent).toContain("1 / 2 approved");
      expect(metadata.textContent).toContain("Demo User");
      expect(screen.getByRole("tab", { name: "Conversation" })).toBeTruthy();
    },
    15000,
  );

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

  it(
    "offers Reactivate instead of Abandon for an abandoned PR",
    async () => {
      renderPanel({ ...pr, status: "abandoned" });
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      expect(await screen.findByRole("menuitem", { name: "Reactivate" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Abandon" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Convert to draft" })).toBeNull();
    },
    15000,
  );

  it(
    "offers Convert to draft for an active non-draft PR",
    async () => {
      renderPanel();
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      expect(await screen.findByRole("menuitem", { name: "Convert to draft" })).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: "Publish" })).toBeNull();
    },
    15000,
  );

  it(
    "shows an Email a link button in the review tab strip",
    async () => {
      renderPanel();
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });
      expect(screen.getByRole("button", { name: "Email a link" })).toBeTruthy();
    },
    15000,
  );
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
      fireEvent.pointerDown(resultTab, { button: 0 });

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

  it(
    "zooms the preview with Ctrl+=/Ctrl+-/Ctrl+0, matching the zoom buttons' tooltips",
    async () => {
      renderPanel();
      await screen.findByRole("button", { name: "Complete" }, { timeout: 8000 });

      // The zoom buttons sit in the dock tab strip; the key handler is on the pane.
      const panel = screen.getByRole("group", { name: "Pull request metadata" }).closest("aside")!;
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("100%");

      fireEvent.keyDown(panel, { key: "=", ctrlKey: true });
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("110%");

      fireEvent.keyDown(panel, { key: "-", ctrlKey: true });
      fireEvent.keyDown(panel, { key: "-", ctrlKey: true });
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("90%");

      fireEvent.keyDown(panel, { key: "0", ctrlKey: true });
      expect(screen.getByRole("button", { name: "Reset preview zoom" }).textContent).toBe("100%");
    },
    8000,
  );
});
