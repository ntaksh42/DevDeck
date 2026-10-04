import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BranchOverviewItem, Organization } from "@/lib/azdoCommands";

const listRepoBranchOverview = vi.fn();
const deleteRepoBranch = vi.fn();
const createRepoBranch = vi.fn();
const listRepoTagOverview = vi.fn();
const createRepoTag = vi.fn();
const deleteRepoTag = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listRepoBranchOverview: (...args: unknown[]) => listRepoBranchOverview(...args),
  listRepoTagOverview: (...args: unknown[]) => listRepoTagOverview(...args),
  createRepoTag: (...args: unknown[]) => createRepoTag(...args),
  deleteRepoTag: (...args: unknown[]) => deleteRepoTag(...args),
  deleteRepoBranch: (...args: unknown[]) => deleteRepoBranch(...args),
  createRepoBranch: (...args: unknown[]) => createRepoBranch(...args),
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
  deleteRepoBranch.mockReset();
  createRepoBranch.mockReset();
  listRepoBranchOverview.mockReset();
  listRepoTagOverview.mockReset().mockResolvedValue([]);
  createRepoTag.mockReset();
  deleteRepoTag.mockReset();
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

  it("deletes a non-default branch only after confirmation, guarding on its tip", async () => {
    deleteRepoBranch.mockResolvedValue(undefined);
    listRepoBranchOverview.mockResolvedValue([
      branch({ name: "main", isDefault: true, lastCommitId: "m1" }),
      branch({ name: "topic", lastCommitId: "t1" }),
    ]);
    renderView();
    await screen.findByText("topic");

    // The default branch cannot be deleted from here.
    expect(screen.getAllByText("Delete")).toHaveLength(1);
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteRepoBranch).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() =>
      expect(deleteRepoBranch).toHaveBeenCalledWith({
        organizationId: "contoso",
        project: "p1",
        repository: "r1",
        name: "topic",
        commitId: "t1",
      }),
    );
  });

  it("creates a branch from a row's tip commit", async () => {
    createRepoBranch.mockResolvedValue(undefined);
    listRepoBranchOverview.mockResolvedValue([
      branch({ name: "main", isDefault: true, lastCommitId: "m1" }),
    ]);
    renderView();
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    fireEvent.change(screen.getByLabelText("New branch name"), { target: { value: "feature/y" } });
    fireEvent.click(screen.getByText("Create"));

    await vi.waitFor(() =>
      expect(createRepoBranch).toHaveBeenCalledWith({
        organizationId: "contoso",
        project: "p1",
        repository: "r1",
        name: "feature/y",
        sourceCommitId: "m1",
      }),
    );
  });

  it("creates a tag at a row's tip commit and refreshes the tag list", async () => {
    createRepoTag.mockResolvedValue(undefined);
    listRepoBranchOverview.mockResolvedValue([
      branch({ name: "main", isDefault: true, lastCommitId: "m1" }),
    ]);
    renderView();
    await screen.findByText("main");
    expect(await screen.findByText("Tags (0)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tag" }));
    fireEvent.change(screen.getByLabelText("New tag name"), { target: { value: "v2.0.0" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create tag" })).getByText("Create"));

    await vi.waitFor(() =>
      expect(createRepoTag).toHaveBeenCalledWith({
        organizationId: "contoso",
        project: "p1",
        repository: "r1",
        name: "v2.0.0",
        commitId: "m1",
      }),
    );
    await vi.waitFor(() => expect(listRepoTagOverview).toHaveBeenCalledTimes(2));
  });

  it("lists tags with their commit and deletes one only after confirmation", async () => {
    deleteRepoTag.mockResolvedValue(undefined);
    listRepoBranchOverview.mockResolvedValue([
      branch({ name: "main", isDefault: true, lastCommitId: "m1" }),
    ]);
    listRepoTagOverview.mockResolvedValue([
      { name: "v1.0.0", commitId: "abcdef1234567890", objectId: "tagobj1" },
    ]);
    renderView();

    expect(await screen.findByText("v1.0.0")).toBeTruthy();
    expect(screen.getByText("abcdef12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));
    expect(deleteRepoTag).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() =>
      expect(deleteRepoTag).toHaveBeenCalledWith({
        organizationId: "contoso",
        project: "p1",
        repository: "r1",
        name: "v1.0.0",
        objectId: "tagobj1",
      }),
    );
  });
});
