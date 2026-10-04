import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const createPullRequest = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  createPullRequest: (...args: unknown[]) => createPullRequest(...args),
}));

import { CreatePullRequestDialog } from "./CreatePullRequestDialog";

const repo = { projectId: "p1", projectName: "Platform", repositoryId: "r1", repositoryName: "web" };

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <CreatePullRequestDialog
        organizationId="contoso"
        repo={repo}
        branches={["main", "develop", "feature/x"]}
        initialSource="feature/x"
        initialTarget="main"
        initialTitle="Add x"
        onClose={onClose}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onClose, onCreated };
}

beforeEach(() => {
  createPullRequest.mockReset();
});
afterEach(cleanup);

describe("CreatePullRequestDialog", () => {
  it("starts with the title focused and submits the chosen branches, text and draft flag", async () => {
    createPullRequest.mockResolvedValue({ pullRequestId: 5, title: "Add x", webUrl: "u" });
    const { onCreated } = renderDialog();
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));

    fireEvent.change(screen.getByLabelText("Into"), { target: { value: "develop" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Why" } });
    fireEvent.click(screen.getByLabelText("Create as draft"));
    fireEvent.click(screen.getByText("Create"));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createPullRequest).toHaveBeenCalledWith({
      organizationId: "contoso",
      projectId: "p1",
      repositoryId: "r1",
      sourceBranch: "feature/x",
      targetBranch: "develop",
      title: "Add x",
      description: "Why",
      isDraft: true,
    });
    expect(onCreated.mock.calls[0][0].pullRequestId).toBe(5);
  });

  it("submits with Ctrl+Enter from the description", async () => {
    createPullRequest.mockResolvedValue({ pullRequestId: 5, title: "Add x", webUrl: "u" });
    const { onCreated } = renderDialog();
    fireEvent.keyDown(screen.getByLabelText(/Description/), { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("blocks same-branch and empty-title submissions", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Into"), { target: { value: "feature/x" } });
    expect(screen.getByText("Pick two different branches.")).toBeTruthy();
    expect((screen.getByText("Create") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Into"), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    expect((screen.getByText("Create") as HTMLButtonElement).disabled).toBe(true);
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it("shows the server error and stays open", async () => {
    createPullRequest.mockRejectedValue(new Error("An active pull request already exists"));
    const { onClose, onCreated } = renderDialog();
    fireEvent.click(screen.getByText("Create"));

    expect(await screen.findByText("An active pull request already exists")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
