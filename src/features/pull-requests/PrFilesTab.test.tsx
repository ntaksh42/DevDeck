import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { PrFilesTab } from "./PrFilesTab";

// This project's vitest config has no global setup, so Testing Library's
// automatic per-test cleanup isn't registered; unmount explicitly so a prior
// render's panel doesn't leak into the next test's `screen` queries.
afterEach(cleanup);

// Odd pullRequestId => demo data includes a third file (config.ts), all
// directly under /src/app/ (see demoPrFilesFor).
const pr: ReviewPullRequestSummary = {
  organizationId: "contoso",
  projectId: "project-1",
  projectName: "Platform",
  repositoryId: "repo-1",
  repositoryName: "azdo-dashboard",
  pullRequestId: 101,
  title: "Test PR",
  createdBy: "Author",
  creationDate: "2026-06-14T00:00:00Z",
  targetRefName: "main",
  webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/101",
  myVote: 0,
  myVoteLabel: "No vote",
  myIsRequired: false,
  isDraft: false,
  mergeStatus: null,
  ciStatus: null,
  ciContext: null,
  ciCheckCount: 0,
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrFilesTab pr={pr} threads={[]} />
    </QueryClientProvider>,
  );
}

describe("PrFilesTab continuous diff scroll", () => {
  it(
    "renders every changed file's diff section at once, not just the selected one",
    async () => {
      renderTab();
      // Each file's path appears both in the tree row and its diff section
      // header, so a title match with count >= 2 confirms the section
      // rendered (not just the tree row) for every file, not only one.
      for (const path of ["/src/app/dashboard.ts", "/src/app/feature-101.ts", "/src/app/config.ts"]) {
        const matches = await screen.findAllByTitle(path, undefined, { timeout: 8000 });
        expect(matches.length).toBeGreaterThanOrEqual(2);
      }
    },
    15000,
  );

  it(
    "filters the file list and diff sections by path substring",
    async () => {
      renderTab();
      await screen.findAllByTitle("/src/app/config.ts", undefined, { timeout: 8000 });

      fireEvent.change(screen.getByRole("searchbox", { name: "Filter files" }), {
        target: { value: "config" },
      });

      expect(screen.queryAllByTitle("/src/app/dashboard.ts")).toHaveLength(0);
      expect(screen.queryAllByTitle("/src/app/feature-101.ts")).toHaveLength(0);
      expect(screen.queryAllByTitle("/src/app/config.ts").length).toBeGreaterThanOrEqual(2);
    },
    15000,
  );

  it(
    "shows an add marker for a new file and no marker for an edited file",
    async () => {
      renderTab();
      await screen.findAllByTitle("/src/app/config.ts", undefined, { timeout: 8000 });

      expect(screen.getByLabelText("add change")).toBeTruthy();
      expect(screen.getAllByLabelText("edited").length).toBe(2);
    },
    15000,
  );
});
