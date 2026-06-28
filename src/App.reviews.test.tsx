import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organization, renderApp } from "./test/appTestHelpers";

const invokeMock = vi.fn();
const openUrlMock = vi.fn();
const openPathMock = vi.fn();
const writeClipboardTextMock = vi.fn();
const tauriEventHandlers = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (eventName: string, handler: (event: { payload: unknown }) => void) => {
    tauriEventHandlers.set(eventName, handler);
    return Promise.resolve(() => {
      tauriEventHandlers.delete(eventName);
    });
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string | URL) => openUrlMock(url),
  openPath: (path: string) => openPathMock(path),
}));

describe("App — Reviews", () => {
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

  it("groups my reviews into collapsible sections and opens the selected row", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: "C:\\reports" });
      }
      if (command === "get_review_result_preview") {
        const pullRequestId = (
          args as { input?: { pullRequestId?: number } } | undefined
        )?.input?.pullRequestId;
        return Promise.resolve(
          pullRequestId === 102
            ? {
                pullRequestId,
                fileName: "review-PR102.html",
                filePath: "C:\\reports\\review-PR102.html",
                html: "<html><body>Waiting author preview</body></html>",
              }
            : null,
        );
      }
      if (command === "get_pull_request_review") {
        const pullRequestId =
          (args as { input?: { pullRequestId?: number } } | undefined)?.input
            ?.pullRequestId ?? 0;
        return Promise.resolve({
          pullRequestId,
          title: `PR ${pullRequestId}`,
          description: null,
          sourceRefName: "refs/heads/feature/x",
          targetRefName: "refs/heads/main",
          createdBy: "Alice",
          creationDate: "2026-05-24T00:00:00Z",
          isDraft: false,
          reviewers: [],
          threads: [],
        });
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
            mergeStatus: "conflicts",
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
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();
    // The vote-filter tabs are gone; rows group into collapsible sections.
    expect(main.queryByRole("tab", { name: "All" })).toBeNull();

    // Section headers always show; "Needs your review" is expanded by default
    // while the other sections start collapsed (their rows hidden).
    expect(await main.findByRole("button", { name: /Needs your review/ })).toBeTruthy();
    expect(main.getByText("Needs review")).toBeTruthy();
    expect(main.getByRole("button", { name: /Waiting for author/ })).toBeTruthy();
    expect(main.getByRole("button", { name: /Rejected by you/ })).toBeTruthy();
    expect(main.queryByText("Waiting on author")).toBeNull();
    expect(main.queryByText("Rejected legacy path")).toBeNull();

    // Expanding a section reveals its rows.
    fireEvent.click(main.getByRole("button", { name: /Waiting for author/ }));
    expect(await main.findByText("Waiting on author")).toBeTruthy();
    expect(main.getByText("Conflicts")).toBeTruthy();

    // Select that row; the Result tab and Ctrl+Enter then act on it.
    fireEvent.click(main.getByText("Waiting on author"));

    fireEvent.click(main.getByRole("tab", { name: "Result" }));
    expect(await main.findByText("review-PR102.html")).toBeTruthy();

    // The Result tab opens the local HTML in the browser via a button…
    fireEvent.click(main.getByRole("button", { name: /Open in browser/ }));
    await waitFor(() => {
      expect(openPathMock).toHaveBeenCalledWith("C:\\reports\\review-PR102.html");
    });

    // …and via the `o` shortcut while the tab is focused.
    openPathMock.mockClear();
    fireEvent.keyDown(main.getByText("review-PR102.html"), { key: "o" });
    await waitFor(() => {
      expect(openPathMock).toHaveBeenCalledWith("C:\\reports\\review-PR102.html");
    });

    fireEvent.keyDown(main.getByRole("grid", { name: "My review pull requests" }), {
      key: "Enter",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/Platform/_git/api/pullrequest/102",
      );
    });
  });

  it("restores review grid focus after a sync refresh removes the focused row", async () => {
    const makeReviewPr = (pullRequestId: number, title: string) => ({
      organizationId: "contoso",
      projectId: "project-1",
      projectName: "Platform",
      repositoryId: "repo-1",
      repositoryName: "azdo-dashboard",
      pullRequestId,
      title,
      createdBy: "Alice",
      creationDate: "2026-06-10T00:00:00Z",
      targetRefName: "main",
      webUrl: null,
      myVote: 0,
      myVoteLabel: "No Vote",
      myIsRequired: true,
      isDraft: false,
    });
    let alphaRemoved = false;
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve(
          alphaRemoved
            ? [makeReviewPr(102, "Beta review")]
            : [makeReviewPr(101, "Alpha review"), makeReviewPr(102, "Beta review")],
        );
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const rowAlpha = (await screen.findByText("Alpha review")).closest(
      "[role='row']",
    ) as HTMLElement;
    fireEvent.click(rowAlpha);
    rowAlpha.focus();
    expect(document.activeElement).toBe(rowAlpha);

    // Background sync finished: the focused PR is no longer assigned.
    alphaRemoved = true;
    tauriEventHandlers.get("sync:updated")?.({ payload: { scopes: ["myReviews"] } });

    await waitFor(() => {
      expect(screen.queryByText("Alpha review")).toBeNull();
    });
    await waitFor(() => {
      const rowBeta = screen.getByText("Beta review").closest("[role='row']");
      expect(document.activeElement).toBe(rowBeta);
    });
  });

  it("marks review rows done locally and restores them", async () => {
    const makeReviewPr = (pullRequestId: number, title: string) => ({
      organizationId: "contoso",
      projectId: "project-1",
      projectName: "Platform",
      repositoryId: "repo-1",
      repositoryName: "azdo-dashboard",
      pullRequestId,
      title,
      createdBy: "Alice",
      creationDate: "2026-06-10T00:00:00Z",
      targetRefName: "main",
      webUrl: null,
      myVote: 0,
      myVoteLabel: "No Vote",
      myIsRequired: true,
      isDraft: false,
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([
          makeReviewPr(101, "Alpha review"),
          makeReviewPr(102, "Beta review"),
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const rowAlpha = (await screen.findByText("Alpha review")).closest(
      "[role='row']",
    ) as HTMLElement;
    fireEvent.click(rowAlpha);
    const grid = screen.getByRole("grid", { name: "My review pull requests" });

    // E marks the selected row done; it leaves the inbox.
    fireEvent.keyDown(grid, { key: "e" });
    await waitFor(() => {
      expect(screen.queryByText("Alpha review")).toBeNull();
    });
    expect(screen.getByText("Beta review")).toBeTruthy();

    // The done view lists it; E restores it back to the inbox.
    fireEvent.click(screen.getByRole("button", { name: "Done (1)" }));
    expect(await screen.findByText("Alpha review")).toBeTruthy();
    expect(screen.queryByText("Beta review")).toBeNull();
    fireEvent.keyDown(grid, { key: "e" });
    await waitFor(() => {
      expect(screen.queryByText("Alpha review")).toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to inbox" }));
    expect(await screen.findByText("Alpha review")).toBeTruthy();
    expect(screen.getByText("Beta review")).toBeTruthy();
  });
});
