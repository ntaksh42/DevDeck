import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.fn();

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

    fireEvent.change(await screen.findByPlaceholderText("title, author, repository, branch"), {
      target: { value: "search" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

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

    await screen.findByText("Run a search to load pull requests.");
    fireEvent.click(screen.getByRole("button", { name: "Work Items" }));
    fireEvent.change(await screen.findByPlaceholderText("title text"), {
      target: { value: "save" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

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
  });

  it("runs in browser preview mode without Tauri internals", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;

    renderApp();

    expect(
      await screen.findByText("Run a search to load pull requests."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Add pull request search dashboard"),
    ).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
