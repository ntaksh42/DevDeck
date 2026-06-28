import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organization, renderApp } from "./test/appTestHelpers";

const invokeMock = vi.fn();
const openUrlMock = vi.fn();
const openPathMock = vi.fn();
const writeClipboardTextMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string | URL) => openUrlMock(url),
  openPath: (path: string) => openPathMock(path),
}));

describe("App — Pull Requests", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openUrlMock.mockReset();
    openPathMock.mockReset();
    writeClipboardTextMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: null });
      }
      if (command === "get_review_result_preview") {
        return Promise.resolve(null);
      }
      if (command === "list_sync_states") {
        return Promise.resolve([]);
      }
      if (command === "trigger_sync") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeClipboardTextMock,
      },
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    cleanup();
  });

  it("searches pull requests and renders results", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "list_commit_repositories") {
        return Promise.resolve([]);
      }
      if (command === "search_pull_requests") {
        return Promise.resolve({
          pullRequests: [
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
              closedDate: null,
              sourceRefName: "feature/pr-search",
              targetRefName: "main",
              webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
              isDraft: false,
            },
          ],
          total: 1,
          truncated: false,
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getAllByRole("button", { name: "Search" })[0]);

    fireEvent.change(await main.findByPlaceholderText("title, author, branch…"), {
      target: { value: "search" },
    });
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_pull_requests", {
        input: {
          organizationId: "contoso",
          query: "search",
          statuses: ["active"],
          projectIds: undefined,
          repositoryIds: undefined,
          targetBranch: undefined,
          fromDate: undefined,
          toDate: undefined,
          dateBasis: "created",
          excludeDrafts: undefined,
          sortBy: "created",
        },
      });
    });
    expect(await screen.findByText("Add pull request search")).toBeTruthy();
    expect(screen.getByText("Platform / azdo-dashboard")).toBeTruthy();

    // Status is now a multi-select filter: non-active statuses are selectable
    // and forwarded to the backend as an array.
    fireEvent.click(main.getByRole("button", { name: "Filter by status" }));
    expect(main.getByRole("option", { name: "Completed" })).toBeTruthy();
    expect(main.getByRole("option", { name: "Abandoned" })).toBeTruthy();
    // Switch the selection from the default active to completed only.
    fireEvent.click(main.getByRole("option", { name: "Active" }));
    fireEvent.click(main.getByRole("option", { name: "Completed" }));
    fireEvent.click(main.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_pull_requests", {
        input: {
          organizationId: "contoso",
          query: "search",
          statuses: ["completed"],
          projectIds: undefined,
          repositoryIds: undefined,
          targetBranch: undefined,
          fromDate: undefined,
          toDate: undefined,
          dateBasis: "created",
          excludeDrafts: undefined,
          sortBy: "created",
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "#42" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
      );
    });
  });

  it("sorts my review rows by grid headers", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: null });
      }
      if (command === "get_review_result_preview") {
        return Promise.resolve(null);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([
          {
            organizationId: "contoso",
            projectId: "platform",
            projectName: "Platform",
            repositoryId: "api",
            repositoryName: "api",
            pullRequestId: 2,
            title: "Second PR",
            createdBy: "Bob",
            creationDate: "2026-05-24T00:00:00Z",
            targetRefName: "main",
            webUrl: "https://dev.azure.com/contoso/Platform/_git/api/pullrequest/2",
            myVote: 0,
            myVoteLabel: "No Vote",
            myIsRequired: true,
            isDraft: false,
          },
          {
            organizationId: "contoso",
            projectId: "platform",
            projectName: "Platform",
            repositoryId: "web",
            repositoryName: "web",
            pullRequestId: 1,
            title: "First PR",
            createdBy: "Alice",
            creationDate: "2026-05-23T00:00:00Z",
            targetRefName: "develop",
            webUrl: "https://dev.azure.com/contoso/Platform/_git/web/pullrequest/1",
            myVote: 0,
            myVoteLabel: "No Vote",
            myIsRequired: false,
            isDraft: false,
          },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    const grid = within(await main.findByRole("grid", { name: "My review pull requests" }));

    expect(grid.getAllByRole("row")[0].textContent).toContain("#2");

    fireEvent.click(main.getByRole("button", { name: "Sort by PR#" }));
    expect(grid.getAllByRole("row")[0].textContent).toContain("#1");
    expect(main.getByRole("columnheader", { name: "PR#" }).getAttribute("aria-sort")).toBe(
      "ascending",
    );

    fireEvent.click(main.getByRole("button", { name: "Sort by PR#" }));
    expect(grid.getAllByRole("row")[0].textContent).toContain("#2");
    expect(main.getByRole("columnheader", { name: "PR#" }).getAttribute("aria-sort")).toBe(
      "descending",
    );
  });
});
