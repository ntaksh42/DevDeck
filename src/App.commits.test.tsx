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

const tauriEventHandlers = new Map<string, Array<(event: { payload: unknown }) => void>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, handler: (event: { payload: unknown }) => void) => {
    const handlers = tauriEventHandlers.get(eventName) ?? [];
    handlers.push(handler);
    tauriEventHandlers.set(eventName, handlers);
    return Promise.resolve(() => {
      tauriEventHandlers.set(
        eventName,
        (tauriEventHandlers.get(eventName) ?? []).filter((existing) => existing !== handler),
      );
    });
  },
}));

function emitTauriEvent(eventName: string, payload: unknown) {
  for (const handler of tauriEventHandlers.get(eventName) ?? []) handler({ payload });
}

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string | URL) => openUrlMock(url),
  openPath: (path: string) => openPathMock(path),
}));

describe("App — Commits", () => {
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

  it("searches commits and renders results", async () => {
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
        return Promise.resolve([
          {
            projectId: "project-1",
            projectName: "Platform",
            repositoryId: "repo-1",
            repositoryName: "azdo-dashboard",
          },
        ]);
      }
      if (command === "search_commits") {
        return Promise.resolve({
          commits: [
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
    fireEvent.click(screen.getByRole("button", { name: "Commits" }));
    fireEvent.change(
      await main.findByPlaceholderText("message, author, SHA — or path:src/auth"),
      {
        target: { value: "commit" },
      },
    );
    // Date inputs live behind the collapsed advanced "Filters" panel.
    fireEvent.click(main.getByRole("button", { name: "Filters" }));
    fireEvent.change(await main.findByLabelText("From"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(main.getByLabelText("To"), {
      target: { value: "2026-05-24" },
    });
    // Project/repository are multi-select filters; open each and pick a value.
    const projectFilter = await main.findByRole("button", { name: "Filter by project" });
    await waitFor(() => expect(projectFilter.hasAttribute("disabled")).toBe(false));
    fireEvent.click(projectFilter);
    fireEvent.click(await main.findByRole("option", { name: "Platform" }));
    fireEvent.click(projectFilter);

    const repositoryFilter = main.getByRole("button", { name: "Filter by repository" });
    await waitFor(() => expect(repositoryFilter.hasAttribute("disabled")).toBe(false));
    fireEvent.click(repositoryFilter);
    fireEvent.click(await main.findByRole("option", { name: "azdo-dashboard" }));
    fireEvent.click(repositoryFilter);

    fireEvent.click(main.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_commits", {
        input: {
          organizationId: "contoso",
          query: "commit",
          author: "",
          branch: "",
          fromDate: "2026-05-01",
          toDate: "2026-05-24",
          projectIds: ["project-1"],
          repositoryIds: ["repo-1"],
        },
      });
    });
    // Scope to the grid: the selected commit's message/SHA now also render in
    // the preview pane, so unscoped queries would match twice.
    const commitGrid = within(await main.findByRole("grid", { name: "Commit search results" }));
    expect(commitGrid.getByText("Add commit search")).toBeTruthy();
    expect(commitGrid.getByRole("button", { name: "abcdef12" })).toBeTruthy();

    fireEvent.click(commitGrid.getByRole("button", { name: "abcdef12" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_git/repo/commit/abcdef1234567890abcdef1234567890abcdef12",
      );
    });
  });

  it("re-runs the last commit search when a commit sync completes", async () => {
    let titles = ["Before sync"];
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") return Promise.resolve([organization]);
      if (command === "get_active_organization") return Promise.resolve(organization);
      if (command === "list_my_review_pull_requests") return Promise.resolve([]);
      if (command === "list_commit_repositories") return Promise.resolve([]);
      if (command === "commit_activity") return Promise.resolve([]);
      if (command === "search_commits") {
        return Promise.resolve({
          commits: titles.map((comment, index) => ({
            organizationId: "contoso",
            projectId: "project-1",
            projectName: "Platform",
            repositoryId: "repo-1",
            repositoryName: "azdo-dashboard",
            commitId: `${index}`.padStart(40, "a"),
            shortCommitId: `aaaa000${index}`,
            comment,
            authorName: "Test User",
            authorEmail: "test@example.com",
            authorDate: "2026-05-24T00:00:00Z",
            webUrl: "https://dev.azure.com/contoso/project/_git/repo/commit/x",
          })),
          total: titles.length,
          truncated: false,
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));
    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(screen.getByRole("button", { name: "Commits" }));
    fireEvent.change(
      await main.findByPlaceholderText("message, author, SHA — or path:src/auth"),
      { target: { value: "sync" } },
    );
    fireEvent.click(main.getByRole("button", { name: "Search" }));
    const grid = within(await main.findByRole("grid", { name: "Commit search results" }));
    expect(await grid.findByText("Before sync")).toBeTruthy();

    titles = ["After sync"];
    emitTauriEvent("sync:updated", { orgId: "other-org", scopes: ["commits"] });
    emitTauriEvent("sync:updated", { orgId: "contoso", scopes: ["myReviews"] });
    expect(invokeMock.mock.calls.filter(([command]) => command === "search_commits")).toHaveLength(1);

    emitTauriEvent("sync:updated", { orgId: "contoso", scopes: ["commits"] });

    expect(await grid.findByText("After sync")).toBeTruthy();
    expect(grid.queryByText("Before sync")).toBeNull();
  });

  it("validates commit date range before searching", async () => {
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
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(screen.getByRole("button", { name: "Commits" }));
    // Date inputs live behind the collapsed advanced "Filters" panel.
    fireEvent.click(await main.findByRole("button", { name: "Filters" }));
    fireEvent.change(await main.findByLabelText("From"), {
      target: { value: "2026-05-25" },
    });
    fireEvent.change(main.getByLabelText("To"), {
      target: { value: "2026-05-24" },
    });
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    expect(await main.findByText("From date must be before or equal to To date.")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith("search_commits", expect.anything());
  });
});
