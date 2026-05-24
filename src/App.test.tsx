import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.fn();
const openUrlMock = vi.fn();

const organization = {
  id: "contoso",
  name: "contoso",
  displayName: "Contoso",
  baseUrl: "https://dev.azure.com/contoso",
  authProvider: "pat",
  credentialKey: "azdodeck:org:contoso:pat",
  authenticatedUserId: "user-1",
  authenticatedUserDisplayName: "Test User",
  createdAt: "2026-05-24T00:00:00Z",
  updatedAt: "2026-05-24T00:00:00Z",
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string | URL) => openUrlMock(url),
}));

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openUrlMock.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    cleanup();
  });

  it("renders setup form when no organization is configured", async () => {
    invokeMock.mockResolvedValueOnce([]);

    renderApp();

    expect(await screen.findByText("Connect Azure DevOps")).toBeTruthy();
    expect(screen.getByText("Organization")).toBeTruthy();
    expect(screen.getByText("Personal access token")).toBeTruthy();
  });

  it("blocks submit when required fields are empty", async () => {
    invokeMock.mockResolvedValueOnce([]);

    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText("Organization and PAT are required."),
    ).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("shows configured organizations", async () => {
    invokeMock.mockResolvedValueOnce([organization]);

    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByText("Organizations")).toBeTruthy();
    expect(screen.getByText("https://dev.azure.com/contoso")).toBeTruthy();
    expect(screen.getByText("PAT")).toBeTruthy();
    expect(screen.getByText("Test User")).toBeTruthy();
  });

  it("submits organization setup to the backend", async () => {
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(organization)
      .mockResolvedValueOnce([]);

    renderApp();

    fireEvent.change(await screen.findByPlaceholderText("contoso"), {
      target: { value: "contoso" },
    });
    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "secret-pat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_pat_organization", {
        input: {
          organization: "contoso",
          pat: "secret-pat",
        },
      });
    });
  });

  it("submits Azure CLI organization setup to the backend", async () => {
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        ...organization,
        authProvider: "azure_cli",
        credentialKey: "azdodeck:org:contoso:azure-cli",
      })
      .mockResolvedValueOnce([]);

    renderApp();

    fireEvent.change(await screen.findByPlaceholderText("contoso"), {
      target: { value: "contoso" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect with Azure CLI" }),
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_azure_cli_organization", {
        input: {
          organization: "contoso",
        },
      });
    });
  });

  it("searches pull requests and renders results", async () => {
    invokeMock
      .mockResolvedValueOnce([organization])
      .mockResolvedValueOnce([
        {
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          repositoryId: "repo-1",
          repositoryName: "azdo-dashboard",
          pullRequestId: 42,
          title: "Add pull request search",
          status: "active",
          createdBy: "Test User",
          creationDate: "2026-05-24T00:00:00Z",
          sourceRefName: "feature/pr-search",
          targetRefName: "main",
          webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
        },
      ]);

    renderApp();
    const main = within(await screen.findByRole("main"));

    fireEvent.change(await main.findByPlaceholderText("title, author, repository, branch"), {
      target: { value: "search" },
    });
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_pull_requests", {
        input: {
          organizationId: "contoso",
          query: "search",
          status: "active",
        },
      });
    });
    expect(await screen.findByText("Add pull request search")).toBeTruthy();
    expect(screen.getByText("Platform / azdo-dashboard")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in Azure DevOps" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
      );
    });
  });

  it("searches work items and renders results", async () => {
    invokeMock
      .mockResolvedValueOnce([organization])
      .mockResolvedValueOnce([
        {
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 123,
          title: "Fix save workflow",
          workItemType: "Bug",
          state: "Active",
          assignedTo: "Test User",
          changedDate: "2026-05-24T00:00:00Z",
          webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
        },
      ]);

    renderApp();
    const main = within(await screen.findByRole("main"));

    await main.findByText("Run a search to load pull requests.");
    fireEvent.click(screen.getByRole("button", { name: "Work Items" }));
    fireEvent.change(await main.findByPlaceholderText("title text"), {
      target: { value: "save" },
    });
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_work_items", {
        input: {
          organizationId: "contoso",
          query: "save",
          state: "all",
          workItemType: "",
        },
      });
    });
    expect(await screen.findByText("Fix save workflow")).toBeTruthy();
    expect(screen.getByText("Test User")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in Azure DevOps" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_workitems/edit/123",
      );
    });
  });

  it("searches commits and renders results", async () => {
    invokeMock
      .mockResolvedValueOnce([organization])
      .mockResolvedValueOnce([
        {
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          repositoryId: "repo-1",
          repositoryName: "azdo-dashboard",
          commitId: "abcdef1234567890abcdef1234567890abcdef12",
          shortCommitId: "abcdef12",
          comment: "Add commit search",
          authorName: "Test User",
          authorEmail: "test@example.com",
          authorDate: "2026-05-24T00:00:00Z",
          webUrl:
            "https://dev.azure.com/contoso/project/_git/repo/commit/abcdef1234567890abcdef1234567890abcdef12",
        },
      ]);

    renderApp();
    const main = within(await screen.findByRole("main"));

    await main.findByText("Run a search to load pull requests.");
    fireEvent.click(screen.getByRole("button", { name: "Commits" }));
    fireEvent.change(
      await main.findByPlaceholderText("message, author, repository, SHA"),
      {
        target: { value: "commit" },
      },
    );
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_commits", {
        input: {
          organizationId: "contoso",
          query: "commit",
          author: "",
          branch: "",
        },
      });
    });
    expect(await screen.findByText("Add commit search")).toBeTruthy();
    expect(screen.getByText("abcdef12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in Azure DevOps" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_git/repo/commit/abcdef1234567890abcdef1234567890abcdef12",
      );
    });
  });

  it("filters my reviews by waiting author and opens the selected row by keyboard", async () => {
    invokeMock
      .mockResolvedValueOnce([organization])
      .mockResolvedValueOnce([
        {
          organizationId: "contoso",
          projectId: "platform",
          projectName: "Platform",
          repositoryId: "api",
          repositoryName: "api",
          pullRequestId: 101,
          title: "Needs review",
          createdBy: "Alice",
          creationDate: "2026-05-24T00:00:00Z",
          targetRefName: "main",
          webUrl: "https://dev.azure.com/contoso/Platform/_git/api/pullrequest/101",
          myVote: 0,
          myVoteLabel: "No Vote",
          myIsRequired: true,
          isDraft: false,
        },
        {
          organizationId: "contoso",
          projectId: "platform",
          projectName: "Platform",
          repositoryId: "api",
          repositoryName: "api",
          pullRequestId: 102,
          title: "Waiting on author",
          createdBy: "Bob",
          creationDate: "2026-05-23T00:00:00Z",
          targetRefName: "main",
          webUrl: "https://dev.azure.com/contoso/Platform/_git/api/pullrequest/102",
          myVote: -5,
          myVoteLabel: "Waiting for Author",
          myIsRequired: false,
          isDraft: false,
        },
        {
          organizationId: "contoso",
          projectId: "platform",
          projectName: "Platform",
          repositoryId: "api",
          repositoryName: "api",
          pullRequestId: 103,
          title: "Rejected legacy path",
          createdBy: "Carol",
          creationDate: "2026-05-22T00:00:00Z",
          targetRefName: "main",
          webUrl: "https://dev.azure.com/contoso/Platform/_git/api/pullrequest/103",
          myVote: -10,
          myVoteLabel: "Rejected",
          myIsRequired: false,
          isDraft: false,
        },
      ]);

    renderApp();
    const main = within(await screen.findByRole("main"));

    await main.findByText("Run a search to load pull requests.");
    fireEvent.keyDown(window, { key: "2", altKey: true });
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();
    expect(await main.findByText("Needs review")).toBeTruthy();
    expect(main.queryByRole("tab", { name: "Rejected" })).toBeNull();

    fireEvent.keyDown(main.getByRole("grid", { name: "My review pull requests" }), {
      key: "3",
    });

    expect(await main.findByText("Waiting on author")).toBeTruthy();
    expect(main.queryByText("Needs review")).toBeNull();
    expect(main.queryByText("Rejected legacy path")).toBeNull();

    fireEvent.keyDown(main.getByRole("grid", { name: "My review pull requests" }), {
      key: "Enter",
    });

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/Platform/_git/api/pullrequest/102",
      );
    });
  });

  it("navigates top-level sections with keyboard shortcuts", async () => {
    invokeMock.mockResolvedValueOnce([organization]);

    renderApp();
    const main = within(await screen.findByRole("main"));

    expect(await main.findByRole("heading", { name: "Pull Requests" })).toBeTruthy();
    await main.findByText("Run a search to load pull requests.");

    fireEvent.keyDown(window, { key: "3", altKey: true });
    expect(await main.findByRole("heading", { name: "Work Items" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "4", altKey: true });
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "5", altKey: true });
    expect(await main.findByRole("heading", { name: "Organizations" })).toBeTruthy();
  });

  it("runs in browser preview mode without Tauri internals", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    renderApp();
    const main = within(await screen.findByRole("main"));

    expect(
      await main.findByText("Run a search to load pull requests."),
    ).toBeTruthy();
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Add pull request search dashboard"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in Azure DevOps" }));

    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
      "_blank",
      "noopener,noreferrer",
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    windowOpenSpy.mockRestore();
  });
});
