import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BranchOverviewItem, Organization } from "@/lib/azdoCommands";

const listRepoBranchOverview = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listRepoBranchOverview: (...args: unknown[]) => listRepoBranchOverview(...args),
}));
const openExternalUrl = vi.fn();
vi.mock("@/lib/openExternal", () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}));

import { CodeBranchesView } from "./CodeBranchesView";

const organization = { baseUrl: "https://dev.azure.com/contoso" } as Organization;
const repo = {
  projectId: "p1",
  projectName: "Platform",
  repositoryId: "r1",
  repositoryName: "web",
};

function branch(overrides: Partial<BranchOverviewItem>): BranchOverviewItem {
  return {
    name: "main",
    isDefault: false,
    ahead: 0,
    behind: 0,
    lastCommitId: "c1",
    lastAuthor: "Ann",
    lastDate: "2026-06-01T00:00:00Z",
    lastComment: "Message",
    pullRequests: [],
    ...overrides,
  };
}

function renderView(onBrowseBranch = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CodeBranchesView
        organization={organization}
        organizationId="contoso"
        repo={repo}
        onBrowseBranch={onBrowseBranch}
      />
    </QueryClientProvider>,
  );
  return onBrowseBranch;
}

beforeEach(() => {
  listRepoBranchOverview.mockReset();
  openExternalUrl.mockReset();
});
afterEach(cleanup);

describe("CodeBranchesView", () => {
  it("lists branches with ahead/behind and offers actions per branch", async () => {
    listRepoBranchOverview.mockResolvedValue([
      branch({ name: "main", isDefault: true }),
      branch({ name: "feature/a", ahead: 3, behind: 1 }),
      branch({
        name: "feature/b",
        ahead: 2,
        pullRequests: [{ pullRequestId: 9, title: "Add B", isDraft: false }],
      }),
    ]);
    const onBrowse = renderView();

    expect(await screen.findByText("feature/a")).toBeTruthy();
    expect(screen.getByText("default")).toBeTruthy();
    // New PR only for a branch ahead of the default and without an active PR.
    expect(screen.getAllByText("New PR")).toHaveLength(1);
    // The default branch has nothing to compare against.
    expect(screen.getAllByText("Compare")).toHaveLength(2);

    fireEvent.click(screen.getByText("New PR"));
    expect(screen.getByRole("dialog", { name: "Create pull request" })).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByText("!9 Add B"));
    expect(openExternalUrl).toHaveBeenLastCalledWith(
      "https://dev.azure.com/contoso/Platform/_git/web/pullrequest/9",
    );

    fireEvent.click(screen.getByText("feature/a"));
    expect(onBrowse).toHaveBeenCalledWith("feature/a");
  });

  it("moves focus between branch rows with the arrow keys", async () => {
    listRepoBranchOverview.mockResolvedValue([
      branch({ name: "main", isDefault: true }),
      branch({ name: "dev" }),
    ]);
    renderView();
    const first = (await screen.findByText("main")).closest("button") as HTMLButtonElement;
    const second = screen.getByText("dev").closest("button") as HTMLButtonElement;

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "k" });
    expect(document.activeElement).toBe(first);
  });
});
