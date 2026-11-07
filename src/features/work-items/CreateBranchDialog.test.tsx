import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemPreview } from "@/lib/azdoCommands";
import { CreateBranchDialog } from "./CreateBranchDialog";

const createBranch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  createWorkItemBranch: createBranch,
  listRepositories: async () => [
    { projectId: "p1", projectName: "P", repositoryId: "r1", repositoryName: "api" },
    { projectId: "other", projectName: "O", repositoryId: "r2", repositoryName: "elsewhere" },
  ],
  listRepoBranches: async () => [
    { name: "develop", isDefault: false },
    { name: "main", isDefault: true },
  ],
}));

afterEach(cleanup);

const preview = {
  organizationId: "org",
  projectId: "p1",
  id: 42,
  title: "Fix login",
  workItemType: "Bug",
} as WorkItemPreview;

function renderDialog(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateBranchDialog preview={preview} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("CreateBranchDialog", () => {
  it("creates the branch from the default base branch and offers the checkout command", async () => {
    createBranch.mockResolvedValue({ branchName: "bug/42-fix-login", linked: true, linkError: null });
    renderDialog();
    expect((screen.getByLabelText("Branch name") as HTMLInputElement).value).toBe("bug/42-fix-login");
    await waitFor(() => expect((screen.getByLabelText("Base branch") as HTMLSelectElement).value).toBe("main"));
    expect(screen.queryByText("elsewhere")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
    expect(await screen.findByText("Linked to the work item.")).toBeTruthy();
    expect(createBranch.mock.calls[0][0]).toEqual({
      organizationId: "org",
      projectId: "p1",
      workItemId: 42,
      repositoryId: "r1",
      baseBranch: "main",
      branchName: "bug/42-fix-login",
    });
    expect(screen.getByRole("button", { name: "Copy checkout command" })).toBeTruthy();
  });

  it("says so when the branch was created but the link failed", async () => {
    createBranch.mockResolvedValue({ branchName: "bug/42-fix-login", linked: false, linkError: "403" });
    renderDialog();
    await waitFor(() => expect((screen.getByLabelText("Base branch") as HTMLSelectElement).value).toBe("main"));
    fireEvent.click(screen.getByRole("button", { name: "Create branch" }));
    expect((await screen.findByRole("alert")).textContent).toContain("linking it to the work item failed: 403");
  });

  it("closes on Escape", () => {
    const onClose = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
