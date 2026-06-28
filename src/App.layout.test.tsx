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

describe("App — Layout", () => {
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

  it("resizes navigation and review preview panes from keyboard handles", async () => {
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
            pullRequestId: 101,
            title: "Needs review",
            createdBy: "Alice",
            creationDate: "2026-05-24T00:00:00Z",
            targetRefName: "main",
            webUrl: null,
            myVote: 0,
            myVoteLabel: "No Vote",
            myIsRequired: true,
            isDraft: false,
          },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("Needs review");
    const navResize = screen.getByRole("separator", { name: "Resize navigation" });
    expect(navResize.getAttribute("aria-valuenow")).toBe("232");
    fireEvent.keyDown(navResize, { key: "ArrowRight" });
    expect(navResize.getAttribute("aria-valuenow")).toBe("248");
    expect(window.localStorage.getItem("azdodeck:layout:sidebarWidth")).toBe("248");
    fireEvent.keyDown(navResize, { key: "Escape" });
    expect(navResize.getAttribute("aria-valuenow")).toBe("232");

    expect(await screen.findByRole("heading", { name: "My Reviews" })).toBeTruthy();
    const previewResize = screen.getByRole("separator", { name: "Resize review preview" });
    expect(previewResize.getAttribute("aria-valuenow")).toBe("420");
    fireEvent.keyDown(previewResize, { key: "ArrowLeft" });
    expect(previewResize.getAttribute("aria-valuenow")).toBe("436");
    expect(window.localStorage.getItem("azdodeck:layout:reviewPreviewWidth")).toBe("436");
    fireEvent.doubleClick(previewResize);
    expect(previewResize.getAttribute("aria-valuenow")).toBe("420");
  });

  it("stops review preview pointer resizing when the pointer is canceled", async () => {
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
            pullRequestId: 101,
            title: "Needs review",
            createdBy: "Alice",
            creationDate: "2026-05-24T00:00:00Z",
            targetRefName: "main",
            webUrl: null,
            myVote: 0,
            myVoteLabel: "No Vote",
            myIsRequired: true,
            isDraft: false,
          },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("Needs review");
    const previewResize = screen.getByRole("separator", { name: "Resize review preview" });

    fireEvent.pointerDown(previewResize, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 84, pointerId: 1 });
    expect(previewResize.getAttribute("aria-valuenow")).toBe("436");

    fireEvent.pointerCancel(window, { pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 60, pointerId: 1 });
    expect(previewResize.getAttribute("aria-valuenow")).toBe("436");
  });

  it("runs in browser preview mode without Tauri internals", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    renderApp();
    const main = within(await screen.findByRole("main"));

    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getAllByRole("button", { name: "Search" })[0]);

    expect(
      await main.findByText("Run a search to load pull requests."),
    ).toBeTruthy();
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Add pull request search dashboard"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "#42" }));

    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://dev.azure.com/contoso/Platform/_git/azdo-dashboard/pullrequest/42",
      "_blank",
      "noopener,noreferrer",
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
    windowOpenSpy.mockRestore();
  });

  it("searches across entities from the command palette and opens a work item in app", async () => {
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
      if (command === "list_sync_states") {
        return Promise.resolve([]);
      }
      if (command === "trigger_sync") {
        return Promise.resolve(undefined);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "list_work_item_projects") {
        return Promise.resolve([]);
      }
      if (command === "search_all") {
        return Promise.resolve({
          workItems: [
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
          ],
          pullRequests: [
            {
              organizationId: "contoso",
              projectId: "project-1",
              projectName: "Platform",
              repositoryId: "repo-1",
              repositoryName: "azdo-dashboard",
              pullRequestId: 1230,
              title: "Add retry backoff",
              status: "active",
              createdBy: "Alice",
              creationDate: "2026-05-24T00:00:00Z",
              closedDate: null,
              sourceRefName: "feature/retry",
              targetRefName: "main",
              webUrl: null,
              isDraft: false,
            },
          ],
          commits: [
            {
              organizationId: "contoso",
              projectId: "project-1",
              projectName: "Platform",
              repositoryId: "repo-1",
              repositoryName: "azdo-dashboard",
              commitId: "abcdef1234567890",
              shortCommitId: "abcdef12",
              comment: "Fix 123 retry delays",
              authorName: "Alice",
              authorEmail: null,
              authorDate: "2026-05-24T00:00:00Z",
              webUrl: null,
            },
          ],
          totals: { workItems: 1, pullRequests: 1, commits: 1 },
        });
      }
      if (command === "search_work_items") {
        return Promise.resolve([
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
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    await screen.findByText("No pull requests assigned to you.");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const paletteInput = await screen.findByPlaceholderText("Type a command or search…");
    fireEvent.change(paletteInput, { target: { value: "123" } });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_all", {
        input: { query: "123" },
      });
    });
    expect(await screen.findByText("#123 Fix save workflow")).toBeTruthy();
    expect(screen.getByText("PR 1230 Add retry backoff")).toBeTruthy();
    expect(screen.getByText("abcdef12 Fix 123 retry delays")).toBeTruthy();

    fireEvent.click(screen.getByText("#123 Fix save workflow"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_work_items", {
        input: {
          organizationId: "contoso",
          query: "123",
          states: undefined,
          workItemTypes: undefined,
          projectIds: undefined,
        },
      });
    });
    const main = within(await screen.findByRole("main"));
    expect((await main.findAllByText("Fix save workflow")).length).toBeGreaterThan(0);

    // Re-opening the palette with an empty query lists the item under Recent.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByText("Recent")).toBeTruthy();
    fireEvent.click(screen.getByText("#123 Fix save workflow"));
    await waitFor(() => {
      const searchCalls = invokeMock.mock.calls.filter(
        ([command]) => command === "search_work_items",
      );
      expect(searchCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
