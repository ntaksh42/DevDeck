import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { updateAppSettings } from "@/lib/azdoCommands";
import { CodeBranchActions } from "./CodeBranchActions";
import type { RepoOption } from "./codeBrowseShared";

const repo: RepoOption = {
  projectId: "platform",
  projectName: "Platform",
  repositoryId: "azdo-dashboard",
  repositoryName: "azdo-dashboard",
};

const branches = [
  { name: "main", isDefault: true },
  { name: "develop", isDefault: false },
];

function renderActions(currentBranch = "develop") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CodeBranchActions
        organizationId="org-1"
        repo={repo}
        branches={branches}
        currentBranch={currentBranch}
        onBranchCreated={() => {}}
      />
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  cleanup();
  // Demo settings are module-level state; reset so other test files (and
  // later tests here) do not inherit read-only mode.
  await updateAppSettings({ readOnlyValidationModeEnabled: false });
});

describe("CodeBranchActions", () => {
  it("disables delete for the default branch", () => {
    renderActions("main");
    const button = screen.getByRole("button", { name: "Delete branch" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("does nothing when the delete confirmation is cancelled", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete branch" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("deletes the branch after confirming in the dialog", async () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete branch" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("rejects branch deletion when read-only validation mode is enabled", async () => {
    await updateAppSettings({ readOnlyValidationModeEnabled: true });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Delete branch" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText(/Read-only validation mode is enabled/i),
    ).toBeTruthy();
  });

  it("rejects branch creation when read-only validation mode is enabled", async () => {
    await updateAppSettings({ readOnlyValidationModeEnabled: true });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "New branch" }));
    fireEvent.change(screen.getByLabelText("New branch name"), {
      target: { value: "feature/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText(/Read-only validation mode is enabled/i),
    ).toBeTruthy();
  });
});
