import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.fn();
const openUrlMock = vi.fn();
const openPathMock = vi.fn();
const writeClipboardTextMock = vi.fn();
const tauriEventHandlers = new Map<string, (event: { payload: unknown }) => void>();

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
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
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
    expect(invokeMock).not.toHaveBeenCalledWith("add_pat_organization", expect.anything());
  });

  it("shows configured organizations", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: "C:\\reports" });
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByText("Organizations")).toBeTruthy();
    expect(screen.getByText("https://dev.azure.com/contoso")).toBeTruthy();
    expect(screen.getByText("PAT")).toBeTruthy();
    expect(screen.getAllByText("Test User").length).toBeGreaterThan(0);
    expect(await screen.findByDisplayValue("C:\\reports")).toBeTruthy();
  });

  it("refreshes synced data after manual sync completes", async () => {
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "trigger_sync") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    const reviewCallsBeforeSync = invokeMock.mock.calls.filter(
      ([command]) => command === "list_my_review_pull_requests",
    ).length;

    fireEvent.click(
      screen.getByTitle("Last background sync — click to sync now"),
    );

    await waitFor(() => {
      const reviewCallsAfterSync = invokeMock.mock.calls.filter(
        ([command]) => command === "list_my_review_pull_requests",
      ).length;
      expect(reviewCallsAfterSync).toBeGreaterThan(reviewCallsBeforeSync);
    });
  });

  it("starts a hot sync after organizations load", async () => {
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "trigger_sync") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trigger_sync", {
        input: { scope: "hot" },
      });
    });
  });

  it("runs hot sync on window focus only after the cooldown", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "trigger_sync") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trigger_sync", {
        input: { scope: "hot" },
      });
    });
    const hotCallsAfterStartup = invokeMock.mock.calls.filter(
      ([command, args]) =>
        command === "trigger_sync" &&
        (args as { input?: { scope?: string } } | undefined)?.input?.scope === "hot",
    ).length;

    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(
      invokeMock.mock.calls.filter(
        ([command, args]) =>
          command === "trigger_sync" &&
          (args as { input?: { scope?: string } } | undefined)?.input?.scope === "hot",
      ).length,
    ).toBe(hotCallsAfterStartup);

    nowSpy.mockReturnValue(1_000 + 3 * 60_000);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(
          ([command, args]) =>
            command === "trigger_sync" &&
            (args as { input?: { scope?: string } } | undefined)?.input?.scope === "hot",
        ).length,
      ).toBeGreaterThan(hotCallsAfterStartup);
    });
    nowSpy.mockRestore();
  });

  it("refreshes the current view with Ctrl+R", async () => {
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "trigger_sync") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trigger_sync", {
        input: { scope: "myReviews" },
      });
    });
  });


  it("invalidates only queries affected by sync update scopes", async () => {
    let reviewCallCount = 0;
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
      if (command === "list_my_review_pull_requests") {
        reviewCallCount += 1;
        return Promise.resolve([]);
      }
      if (command === "trigger_sync") {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    await waitFor(() => expect(tauriEventHandlers.has("sync:updated")).toBe(true));
    const callsBeforeWorkItemUpdate = reviewCallCount;

    tauriEventHandlers.get("sync:updated")?.({
      payload: { orgId: "contoso", scopes: ["myWorkItems"] },
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(reviewCallCount).toBe(callsBeforeWorkItemUpdate);

    tauriEventHandlers.get("sync:updated")?.({
      payload: { orgId: "contoso", scopes: ["myReviews"] },
    });

    await waitFor(() => {
      expect(reviewCallCount).toBeGreaterThan(callsBeforeWorkItemUpdate);
    });
  });

  it("saves review result folder settings", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: null, showWindowHotkey: null });
      }
      if (command === "update_app_settings") {
        return Promise.resolve(
          (args as { input: { reviewResultFolderPath: string; showWindowHotkey: string | null } }).input,
        );
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Review result previews" })).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByLabelText("Folder path") as HTMLInputElement).value).toBe("");
    });
    const folderPathInput = screen.getByLabelText("Folder path");
    fireEvent.change(folderPathInput, {
      target: { value: "D:\\azdo-review-results" },
    });
    expect((folderPathInput as HTMLInputElement).value).toBe("D:\\azdo-review-results");
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[2]);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_app_settings", {
        input: {
          reviewResultFolderPath: "D:\\azdo-review-results",
          showWindowHotkey: null,
          readOnlyValidationModeEnabled: false,
          desktopNotificationsEnabled: false,
          notificationContentPreviewEnabled: true,
          notifyWorkItemAssignments: true,
          notifyWorkItemStateChanges: true,
          notifyPrReviewRequests: true,
          notifyPrVoteResets: true,
          notifyPrCommentReplies: true,
          reviewStaleThresholdDays: 3,
          workItemStaleThresholdDays: 7,
          notificationRules: [],
        },
      });
    });
    expect(await screen.findByText("Review result folder saved.")).toBeTruthy();
  });

  it("saves the show window hotkey setting", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({
          reviewResultFolderPath: "C:\\reports",
          showWindowHotkey: null,
        });
      }
      if (command === "update_app_settings") {
        return Promise.resolve(
          (args as { input: { reviewResultFolderPath: string | null; showWindowHotkey: string } }).input,
        );
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Show window hotkey" })).toBeTruthy();
    const hotkeyInput = screen.getByLabelText("Show window hotkey");
    fireEvent.keyDown(hotkeyInput, {
      key: "d",
      code: "KeyD",
      ctrlKey: true,
      altKey: true,
    });
    expect((hotkeyInput as HTMLInputElement).value).toBe("Ctrl+Alt+D");
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_app_settings", {
        input: {
          reviewResultFolderPath: "C:\\reports",
          showWindowHotkey: "Ctrl+Alt+D",
          readOnlyValidationModeEnabled: false,
          desktopNotificationsEnabled: false,
          notificationContentPreviewEnabled: true,
          notifyWorkItemAssignments: true,
          notifyWorkItemStateChanges: true,
          notifyPrReviewRequests: true,
          notifyPrVoteResets: true,
          notifyPrCommentReplies: true,
          reviewStaleThresholdDays: 3,
          workItemStaleThresholdDays: 7,
          notificationRules: [],
        },
      });
    });
    expect(await screen.findByText("Show window hotkey saved.")).toBeTruthy();
  });

  it("saves desktop notification settings", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({
          reviewResultFolderPath: null,
          showWindowHotkey: null,
          desktopNotificationsEnabled: false,
          notificationContentPreviewEnabled: true,
          notifyWorkItemAssignments: true,
          notifyWorkItemStateChanges: true,
        });
      }
      if (command === "update_app_settings") {
        return Promise.resolve((args as { input: unknown }).input);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Desktop notifications" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Enable desktop notifications"));
    fireEvent.click(screen.getByLabelText("State changes"));
    fireEvent.click(screen.getByLabelText("Show title in notification"));
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_app_settings", {
        input: {
          reviewResultFolderPath: null,
          showWindowHotkey: null,
          readOnlyValidationModeEnabled: false,
          desktopNotificationsEnabled: true,
          notificationContentPreviewEnabled: false,
          notifyWorkItemAssignments: true,
          notifyWorkItemStateChanges: false,
          notifyPrReviewRequests: true,
          notifyPrVoteResets: true,
          notifyPrCommentReplies: true,
          reviewStaleThresholdDays: 3,
          workItemStaleThresholdDays: 7,
          notificationRules: [],
        },
      });
    });
    expect(await screen.findByText("Desktop notification settings saved.")).toBeTruthy();
  });

  it("saves read-only validation mode", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({
          reviewResultFolderPath: null,
          showWindowHotkey: null,
          readOnlyValidationModeEnabled: false,
          desktopNotificationsEnabled: false,
          notificationContentPreviewEnabled: true,
          notifyWorkItemAssignments: true,
          notifyWorkItemStateChanges: true,
        });
      }
      if (command === "update_app_settings") {
        return Promise.resolve((args as { input: unknown }).input);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Validation mode" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Read-only validation mode"));
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[3]);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_app_settings", {
        input: {
          reviewResultFolderPath: null,
          showWindowHotkey: null,
          readOnlyValidationModeEnabled: true,
          desktopNotificationsEnabled: false,
          notificationContentPreviewEnabled: true,
          notifyWorkItemAssignments: true,
          notifyWorkItemStateChanges: true,
          notifyPrReviewRequests: true,
          notifyPrVoteResets: true,
          notifyPrCommentReplies: true,
          reviewStaleThresholdDays: 3,
          workItemStaleThresholdDays: 7,
          notificationRules: [],
        },
      });
    });
    expect(await screen.findByText("Validation mode saved.")).toBeTruthy();
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
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
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
          status: "active",
          projectId: undefined,
          repositoryId: undefined,
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
    // Non-active statuses are now selectable and forwarded to the backend.
    expect(main.getByRole("option", { name: "Completed" })).toBeTruthy();
    expect(main.getByRole("option", { name: "Abandoned" })).toBeTruthy();
    expect(main.getByRole("option", { name: "All" })).toBeTruthy();

    fireEvent.change(main.getByRole("combobox", { name: /Status/i }), {
      target: { value: "completed" },
    });
    fireEvent.click(main.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_pull_requests", {
        input: {
          organizationId: "contoso",
          query: "search",
          status: "completed",
          projectId: undefined,
          repositoryId: undefined,
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

  it("searches work items and renders results", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "list_work_item_projects") {
        return Promise.resolve([
          {
            projectId: "project-1",
            projectName: "Platform",
          },
        ]);
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
          {
            organizationId: "contoso",
            projectId: "project-1",
            projectName: "Platform",
            id: 124,
            title: "Review save workflow",
            workItemType: "Task",
            state: "Active",
            assignedTo: "Test User",
            changedDate: "2026-05-23T00:00:00Z",
            webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/124",
          },
        ]);
      }
      if (command === "get_work_item_preview") {
        return Promise.resolve({
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 123,
          title: "Fix save workflow",
          workItemType: "Bug",
          state: "Active",
          assignedTo: "Test User",
          assignedToUniqueName: null,
          createdBy: "Creator",
          createdDate: "2026-05-23T00:00:00Z",
          changedDate: "2026-05-24T00:00:00Z",
          areaPath: "Platform\\Product",
          iterationPath: "Platform\\Sprint 24",
          reason: "Work started",
          tags: "save; bug",
          priority: "1",
          severity: "2 - High",
          storyPoints: null,
          remainingWork: null,
          descriptionHtml:
            '<p>Fix the save flow.</p><img src="https://example.test/save-flow.png" alt="Save flow diagram">',
          acceptanceCriteriaHtml: "<ul><li>Save succeeds</li></ul>",
          webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
          comments: [
            {
              id: 8,
              text: '<div><a href="#" data-vss-mention="version:2.0,9ce68702-0694-6ef4-b9fa-0f3143502233">@Creator</a>&nbsp;Posted from Azure</div>',
              renderedText:
                '&lt;div&gt;&lt;a href=&quot;#&quot; data-vss-mention=&quot;version:2.0,9ce68702-0694-6ef4-b9fa-0f3143502233&quot;&gt;@Creator&lt;/a&gt;&amp;nbsp;Posted from Azure&lt;/div&gt;',
              createdBy: "Creator",
              createdById: "9ce68702-0694-6ef4-b9fa-0f3143502233",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T13:00:00Z",
            },
            {
              id: 7,
              text: "@<9ce68702-0694-6ef4-b9fa-0f3143502233> Earlier context",
              renderedText: "<p>@&lt;9ce68702-0694-6ef4-b9fa-0f3143502233&gt; Earlier context</p>",
              createdBy: "Creator",
              createdById: "9ce68702-0694-6ef4-b9fa-0f3143502233",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T12:00:00Z",
            },
            {
              id: 6,
              text: '<div><a href="#" data-vss-mention="version:2.0,user-reviewer">@Reviewer</a>&nbsp;Raw text fallback</div><div><br></div>',
              renderedText: null,
              createdBy: "Reviewer",
              createdById: "user-reviewer",
              createdByUniqueName: "reviewer@example.com",
              createdDate: "2026-05-23T11:30:00Z",
            },
            {
              id: 5,
              text: "Older context",
              renderedText: "<p>Older context</p>",
              createdBy: "Reviewer",
              createdById: "user-reviewer",
              createdByUniqueName: "reviewer@example.com",
              createdDate: "2026-05-23T11:00:00Z",
            },
          ],
        });
      }
      if (command === "search_work_item_mentions") {
        return Promise.resolve([
          {
            id: "9ce68702-0694-6ef4-b9fa-0f3143502233",
            displayName: "Creator",
            uniqueName: "creator@example.com",
          },
        ]);
      }
      if (command === "search_work_item_assignees") {
        return Promise.resolve([
          {
            id: "9ce68702-0694-6ef4-b9fa-0f3143502233",
            displayName: "Creator",
            uniqueName: "creator@example.com",
            assignValue: "Creator <creator@example.com>",
          },
        ]);
      }
      if (command === "update_work_item_fields") {
        const fields =
          (
            args as
              | { input?: { fields?: { referenceName: string; value: string }[] } }
              | undefined
          )?.input?.fields ?? [];
        const stateValue = fields.find((f) => f.referenceName === "System.State")?.value;
        const assigneeValue = fields.find(
          (f) => f.referenceName === "System.AssignedTo",
        )?.value;
        return Promise.resolve({
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 123,
          title: "Fix save workflow",
          workItemType: "Bug",
          state: stateValue ?? "Active",
          assignedTo: assigneeValue?.startsWith("Creator") ? "Creator" : "Test User",
          assignedToUniqueName: null,
          createdBy: "Creator",
          createdDate: "2026-05-23T00:00:00Z",
          changedDate: "2026-05-24T01:00:00Z",
          areaPath: "Platform\\Product",
          iterationPath: "Platform\\Sprint 24",
          reason: "Work started",
          tags: "save; bug",
          priority: "1",
          severity: "2 - High",
          storyPoints: null,
          remainingWork: null,
          descriptionHtml:
            '<p>Fix the save flow.</p><img src="https://example.test/save-flow.png" alt="Save flow diagram">',
          acceptanceCriteriaHtml: "<ul><li>Save succeeds</li></ul>",
          webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
          comments: [
            {
              id: 7,
              text: "Earlier context",
              renderedText: "<p>Earlier context</p>",
              createdBy: "Creator",
              createdById: "9ce68702-0694-6ef4-b9fa-0f3143502233",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T12:00:00Z",
            },
          ],
        });
      }
      if (command === "add_work_item_comment") {
        return Promise.resolve({
          id: 1,
          text: "@<9ce68702-0694-6ef4-b9fa-0f3143502233> please check",
          renderedText: "<p>@Creator please check</p>",
          createdBy: "Test User",
          createdDate: "2026-05-24T00:00:00Z",
        });
      }
      if (command === "list_work_item_type_states") {
        return Promise.resolve(["Active", "Resolved", "Closed"]);
      }
      if (command === "record_mention_interaction") {
        return Promise.resolve(null);
      }
      if (command === "record_assignee_interaction") {
        return Promise.resolve(null);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getAllByRole("button", { name: "Search" })[1]);
    await main.findByText("Platform");
    fireEvent.change(await main.findByPlaceholderText("Search work items…"), {
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
          projectId: undefined,
        },
      });
      expect(invokeMock).toHaveBeenCalledWith("list_work_item_projects", {
        input: {
          organizationId: "contoso",
        },
      });
    });
    expect((await screen.findAllByText("Fix save workflow")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Test User").length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Comment")).toBeTruthy();
    // Grid title cell plus the preview heading (which shows the full title on hover).
    expect(screen.getAllByTitle("Fix save workflow")).toHaveLength(2);
    const previewLabels = [...document.querySelectorAll("dt")].map((node) =>
      node.textContent?.trim(),
    );
    expect(previewLabels).not.toContain("Author");
    expect(previewLabels).not.toContain("Created");
    expect(previewLabels).not.toContain("Changed");
    expect(previewLabels).not.toContain("Severity");
    fireEvent.click(screen.getByRole("button", { name: "Configure preview fields" }));
    fireEvent.click(screen.getByLabelText("Severity"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const updatedPreviewLabels = [...document.querySelectorAll("dt")].map((node) =>
      node.textContent?.trim(),
    );
    expect(updatedPreviewLabels).toContain("Severity");
    expect(screen.getByText("2 - High")).toBeTruthy();
    expect(window.localStorage.getItem("azdodeck:workItems:previewFields")).toContain(
      "severity",
    );
    const descriptionFrame = document.querySelector(
      'iframe[title="Description"]',
    ) as HTMLIFrameElement | null;
    expect(descriptionFrame).toBeTruthy();
    expect(descriptionFrame?.getAttribute("scrolling")).toBe("no");
    expect(descriptionFrame?.style.maxHeight).toBe("");
    const commentSrcDocs = [
      ...document.querySelectorAll('iframe[title="Comment by Creator"]'),
    ].map((frame) => frame.getAttribute("srcdoc") ?? "");
    expect(
      commentSrcDocs.some(
        (srcDoc) =>
          srcDoc.includes('data-vss-mention="version:2.0,9ce68702-0694-6ef4-b9fa-0f3143502233"') &&
          srcDoc.includes("@Creator</a>&nbsp;Posted from Azure"),
      ),
    ).toBe(true);
    expect(commentSrcDocs.some((srcDoc) => srcDoc.includes("&lt;div&gt;"))).toBe(
      false,
    );
    expect(
      commentSrcDocs.some((srcDoc) =>
        srcDoc.includes(
          '<span class="azdo-mention">@Creator</span> Earlier context',
        ),
      ),
    ).toBe(true);
    expect(
      commentSrcDocs.some((srcDoc) => srcDoc.includes("@&lt;9ce68702-0694-6ef4-b9fa-0f3143502233&gt;")),
    ).toBe(false);
    expect(
      [
        ...document.querySelectorAll('iframe[title^="Comment by "]'),
      ].map((frame) => frame.getAttribute("srcdoc") ?? ""),
    ).toHaveLength(4);
    expect(
      [...document.querySelectorAll('iframe[title="Comment by Reviewer"]')].some(
        (frame) => (frame.getAttribute("srcdoc") ?? "").includes("Older context"),
      ),
    ).toBe(true);
    const reviewerCommentSrcDocs = [
      ...document.querySelectorAll('iframe[title="Comment by Reviewer"]'),
    ].map((frame) => frame.getAttribute("srcdoc") ?? "");
    expect(
      reviewerCommentSrcDocs.some((srcDoc) =>
        srcDoc.includes("@Reviewer</a>&nbsp;Raw text fallback"),
      ),
    ).toBe(true);
    expect(
      reviewerCommentSrcDocs.some((srcDoc) => srcDoc.includes("&lt;div&gt;")),
    ).toBe(false);

    // Preview sections collapse and re-expand from the header toggle.
    const commentsToggle = screen.getByRole("button", { name: "Comments (4)" });
    expect(commentsToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(commentsToggle);
    expect(commentsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelectorAll('iframe[title^="Comment by "]')).toHaveLength(0);
    fireEvent.click(commentsToggle);
    expect(
      document.querySelectorAll('iframe[title^="Comment by "]').length,
    ).toBe(4);

    const workItemsGrid = screen.getByRole("grid", { name: "Work items" });
    fireEvent.keyDown(workItemsGrid, { key: "a" });
    expect(await screen.findByPlaceholderText("Search assignee...")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /creator@example.com/ }));

    // Selection only stages the change; nothing is written yet.
    expect(invokeMock).not.toHaveBeenCalledWith(
      "update_work_item_fields",
      expect.anything(),
    );
    const pendingChip = await screen.findByText("1 pending");
    expect(pendingChip.parentElement?.getAttribute("title")).toContain("Assignee:");

    // Esc discards staged changes without writing.
    fireEvent.keyDown(screen.getByText("1 pending"), { key: "Escape" });
    expect(screen.queryByText("1 pending")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "update_work_item_fields",
      expect.anything(),
    );

    // Stage again and apply.
    fireEvent.keyDown(workItemsGrid, { key: "a" });
    fireEvent.click(await screen.findByRole("button", { name: /creator@example.com/ }));
    expect(await screen.findByText("1 pending")).toBeTruthy();

    // Ctrl+S applies the staged change.
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_work_item_fields", {
        input: {
          organizationId: "contoso",
          projectId: "project-1",
          workItemId: 123,
          fields: [
            {
              referenceName: "System.AssignedTo",
              value: "Creator <creator@example.com>",
            },
          ],
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("1 pending")).toBeNull();
    });
    await waitFor(() => {
      expect(within(workItemsGrid).getAllByText("Creator").length).toBeGreaterThan(0);
    });

    // A successful assignment is learned into the local assignee history.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("record_assignee_interaction", {
        input: {
          organizationId: "contoso",
          userId: "9ce68702-0694-6ef4-b9fa-0f3143502233",
          displayName: "Creator",
          uniqueName: "creator@example.com",
        },
      });
    });

    // Undo restores the pre-apply assignee.
    expect(screen.getByText("Applied 1")).toBeTruthy();
    fireEvent.keyDown(workItemsGrid, { key: "u" });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_work_item_fields", {
        input: {
          organizationId: "contoso",
          projectId: "project-1",
          workItemId: 123,
          fields: [{ referenceName: "System.AssignedTo", value: "Test User" }],
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("Applied 1")).toBeNull();
    });

    // Ctrl+Enter in the comment box posts the comment and applies staged
    // property changes in one step.
    fireEvent.keyDown(workItemsGrid, { key: "s" });
    fireEvent.click(await screen.findByRole("button", { name: "Resolved" }));
    expect(await screen.findByText("1 pending")).toBeTruthy();
    fireEvent.keyDown(workItemsGrid, { key: "m" });
    const comboCommentBox = screen.getByLabelText("Comment");
    fireEvent.change(comboCommentBox, { target: { value: "Closing this" } });
    fireEvent.keyDown(comboCommentBox, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_work_item_fields", {
        input: {
          organizationId: "contoso",
          projectId: "project-1",
          workItemId: 123,
          fields: [{ referenceName: "System.State", value: "Resolved" }],
        },
      });
      expect(invokeMock).toHaveBeenCalledWith(
        "add_work_item_comment",
        expect.objectContaining({
          input: expect.objectContaining({ workItemId: 123 }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("1 pending")).toBeNull();
    });

    fireEvent.keyDown(workItemsGrid, { key: "m" });
    let commentBox = screen.getByLabelText("Comment");
    expect(document.activeElement).toBe(commentBox);
    (commentBox as HTMLTextAreaElement).blur();
    fireEvent.keyDown(window, { key: "m", altKey: true });
    expect(document.activeElement).toBe(commentBox);
    fireEvent.keyDown(window, { key: "g", altKey: true });
    expect(document.activeElement?.getAttribute("role")).toBe("row");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(window, { key: "p", altKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Work item preview"));
    fireEvent.keyDown(document.activeElement ?? workItemsGrid, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("Work item preview"));
    expect(document.activeElement).not.toBe(commentBox);

    // Esc returns focus from the preview to the grid.
    fireEvent.keyDown(document.activeElement ?? workItemsGrid, { key: "Escape" });
    expect(document.activeElement?.getAttribute("role")).toBe("row");

    // Ctrl+K opens the palette even while the grid handles single-key moves.
    fireEvent.keyDown(document.activeElement ?? workItemsGrid, { key: "k", ctrlKey: true });
    const paletteInput = await screen.findByPlaceholderText("Type a command or search…");
    fireEvent.keyDown(paletteInput, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Type a command or search…")).toBeNull();
    });
    fireEvent.keyDown(window, { key: "g", altKey: true });
    expect(document.activeElement?.getAttribute("role")).toBe("row");
    fireEvent.keyDown(document.activeElement ?? workItemsGrid, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "m", altKey: true });
    commentBox = screen.getByLabelText("Comment");
    expect(document.activeElement).toBe(commentBox);
    fireEvent.change(commentBox, { target: { value: "@" } });
    (commentBox as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.click(commentBox);
    fireEvent.click(await screen.findByRole("button", { name: /Creator/ }));
    fireEvent.change(commentBox, { target: { value: "@Creator please check" } });
    fireEvent.keyDown(commentBox, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_work_item_comment", {
        input: {
          organizationId: "contoso",
          projectId: "project-1",
          workItemId: 123,
          markdown: "@<9ce68702-0694-6ef4-b9fa-0f3143502233> please check",
        },
      });
    });

    // Field presets: save the pending change under a name, discard, then
    // re-stage it with the digit shortcut.
    fireEvent.keyDown(workItemsGrid, { key: "s" });
    fireEvent.click(await screen.findByRole("button", { name: "Closed" }));
    expect(await screen.findByText("1 pending")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Field presets" }));
    fireEvent.change(screen.getByLabelText("New preset name"), {
      target: { value: "Close it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: /^1\s?Close it$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard pending changes" }));
    expect(screen.queryByText("1 pending")).toBeNull();

    fireEvent.keyDown(screen.getByLabelText("Work item preview"), { key: "1" });
    const presetChip = await screen.findByText("1 pending");
    expect(presetChip.parentElement?.getAttribute("title")).toContain("State");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "update_work_item_fields",
      expect.objectContaining({
        input: expect.objectContaining({
          fields: [{ referenceName: "System.State", value: "Closed" }],
        }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard pending changes" }));

    // Verify switching work items clears the unsent comment draft.
    const draftBox = screen.getByLabelText("Comment") as HTMLTextAreaElement;
    fireEvent.change(draftBox, { target: { value: "unsent draft" } });
    expect(draftBox.value).toBe("unsent draft");
    fireEvent.click(
      within(workItemsGrid).getByRole("row", { name: /Review save workflow/ }),
    );
    await waitFor(() => {
      expect((screen.getByLabelText("Comment") as HTMLTextAreaElement).value).toBe("");
    });

    fireEvent.click(screen.getByRole("button", { name: "#123" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_workitems/edit/123",
      );
    });
  });

  it("edits custom preview fields from the keyboard with F", async () => {
    window.localStorage.setItem(
      "azdodeck:workItems:previewCustomFields",
      JSON.stringify([
        { referenceName: "Custom.ReleaseTrain", label: "Release Train" },
        { referenceName: "Custom.CustomerImpact", label: "Customer Impact" },
      ]),
    );
    const makePreview = (releaseTrain: string) => ({
      organizationId: "contoso",
      projectId: "project-1",
      projectName: "Platform",
      id: 123,
      title: "Fix save workflow",
      workItemType: "Bug",
      state: "Active",
      assignedTo: "Test User",
      assignedToUniqueName: null,
      createdBy: "Creator",
      createdDate: "2026-05-23T00:00:00Z",
      changedDate: "2026-05-24T00:00:00Z",
      areaPath: "Platform\\Product",
      iterationPath: "Platform\\Sprint 24",
      reason: "Work started",
      tags: null,
      priority: "1",
      severity: null,
      storyPoints: null,
      remainingWork: null,
      descriptionHtml: "<p>Fix the save flow.</p>",
      acceptanceCriteriaHtml: null,
      webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
      customFields: [
        { referenceName: "Custom.ReleaseTrain", value: releaseTrain },
        { referenceName: "Custom.CustomerImpact", value: "Low" },
      ],
      comments: [],
    });
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
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
      if (command === "list_work_item_projects") {
        return Promise.resolve([{ projectId: "project-1", projectName: "Platform" }]);
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
      if (command === "get_work_item_preview") {
        return Promise.resolve(makePreview("Tokyo"));
      }
      if (command === "list_work_item_field_allowed_values") {
        const referenceName = (
          args as { input?: { fieldReferenceName?: string } } | undefined
        )?.input?.fieldReferenceName;
        return Promise.resolve(
          referenceName === "Custom.ReleaseTrain" ? ["Tokyo", "Osaka"] : ["Low", "High"],
        );
      }
      if (command === "update_work_item_fields") {
        return Promise.resolve(makePreview("Osaka"));
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Primary navigation" })).getAllByRole(
        "button",
        { name: "Search" },
      )[1],
    );
    fireEvent.change(await main.findByPlaceholderText("Search work items…"), {
      target: { value: "save" },
    });
    fireEvent.click(main.getByRole("button", { name: "Search" }));
    await screen.findByLabelText("Comment");

    const workItemsGrid = screen.getByRole("grid", { name: "Work items" });

    // F opens the first custom field's picker.
    fireEvent.keyDown(workItemsGrid, { key: "f" });
    expect(await screen.findByLabelText("Custom value for Release Train")).toBeTruthy();

    // Pressing F again cycles to the next custom field.
    fireEvent.keyDown(workItemsGrid, { key: "f" });
    expect(await screen.findByLabelText("Custom value for Customer Impact")).toBeTruthy();
    expect(screen.queryByLabelText("Custom value for Release Train")).toBeNull();

    // Wrap around to the first field and stage a value; nothing is written yet.
    fireEvent.keyDown(workItemsGrid, { key: "f" });
    fireEvent.click(await screen.findByRole("button", { name: /Osaka/ }));
    expect(await screen.findByText("1 pending")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "update_work_item_fields",
      expect.anything(),
    );

    // Ctrl+S applies the staged custom field change.
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_work_item_fields", {
        input: {
          organizationId: "contoso",
          projectId: "project-1",
          workItemId: 123,
          fields: [{ referenceName: "Custom.ReleaseTrain", value: "Osaka" }],
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText("1 pending")).toBeNull();
    });
  });

  it("saves a work item view and renders query results with preview", async () => {
    const viewResults = [
      {
        organizationId: "contoso",
        projectId: "project-1",
        projectName: "Platform",
        id: 321,
        title: "Fix view query workflow",
        workItemType: "Bug",
        state: "Active",
        assignedTo: "Test User",
        changedDate: "2026-05-24T00:00:00Z",
        webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/321",
      },
    ];
    let runViewQueryCount = 0;
    let holdRunViewRefetch = false;
    let resolveRefetch: ((value: typeof viewResults) => void) | undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      if (command === "list_work_item_projects") {
        return Promise.resolve([
          {
            projectId: "project-1",
            projectName: "Platform",
          },
        ]);
      }
      if (command === "run_work_item_query") {
        runViewQueryCount += 1;
        if (!holdRunViewRefetch) {
          return Promise.resolve(viewResults);
        }
        return new Promise<typeof viewResults>((resolve) => {
          resolveRefetch = resolve;
        });
      }
      if (command === "get_work_item_preview") {
        return Promise.resolve({
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 321,
          title: "Fix view query workflow",
          workItemType: "Bug",
          state: "Active",
          assignedTo: "Test User",
          assignedToUniqueName: null,
          createdBy: "Creator",
          createdDate: "2026-05-23T00:00:00Z",
          changedDate: "2026-05-24T00:00:00Z",
          areaPath: "Platform\\Product",
          iterationPath: "Platform\\Sprint 24",
          reason: "Work started",
          tags: "view; bug",
          priority: "1",
          severity: "2 - High",
          storyPoints: null,
          remainingWork: null,
          descriptionHtml: "<p>Fix the saved view workflow.</p>",
          acceptanceCriteriaHtml: "<ul><li>View results render</li></ul>",
          webUrl: "https://dev.azure.com/contoso/project/_workitems/edit/321",
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: "Views" }));
    fireEvent.click(await main.findByRole("button", { name: /Add/ }));
    await screen.findByRole("dialog", { name: "Add View" });
    await main.findByText("Platform");

    fireEvent.change(main.getByLabelText("Name"), {
      target: { value: "Active Bugs" },
    });
    fireEvent.change(main.getByLabelText("Project"), {
      target: { value: "project-1" },
    });
    fireEvent.change(main.getByLabelText("WIQL"), {
      target: {
        value:
          "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Bug'",
      },
    });
    fireEvent.keyDown(main.getByLabelText("WIQL"), { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("run_work_item_query", {
        input: {
          organizationId: "contoso",
          projectId: "project-1",
          wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Bug'",
          limit: 200,
          extraFields: [],
        },
      });
    });
    expect((await screen.findAllByText("Fix view query workflow")).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Comment")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Active Bugs/ })).toBeTruthy();
    const viewListbox = screen.getByRole("listbox", { name: "Saved work item views" });
    expect(viewListbox).toBeTruthy();
    Object.defineProperty(viewListbox, "clientWidth", {
      configurable: true,
      value: 560,
    });
    const viewCards = within(viewListbox).getAllByRole("option");
    fireEvent.click(viewCards[0]);
    viewCards[0].focus();
    fireEvent.keyDown(viewListbox, { key: "ArrowDown" });
    expect(viewCards[3].getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(viewCards[3]));
    fireEvent.keyDown(viewListbox, { key: "ArrowUp" });
    expect(viewCards[0].getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(viewCards[0]));
    fireEvent.click(screen.getByRole("option", { name: /Active Bugs/ }));
    const viewWorkItemRow = screen.getByRole("row", {
      name: /Fix view query workflow/,
    });
    viewWorkItemRow.focus();
    expect(document.activeElement).toBe(viewWorkItemRow);
    holdRunViewRefetch = true;
    fireEvent.click(screen.getByTitle("Run all views (R)"));
    await waitFor(() => expect(resolveRefetch).toBeDefined());
    expect(screen.getByRole("row", { name: /Fix view query workflow/ })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(document.activeElement).toBe(viewWorkItemRow);
    resolveRefetch!(viewResults);

    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(screen.getByRole("button", { name: "Active Bugs" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy selected view share JSON" }));
    await waitFor(() => {
      expect(writeClipboardTextMock).toHaveBeenCalledWith(
        expect.stringContaining('"name": "Active Bugs"'),
      );
    });
    expect(writeClipboardTextMock.mock.calls[0][0]).toContain("azdodeck.workItemViews");
  });

  it("nests pinned work item views under Views and toggles their visibility", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    await screen.findByText("No pull requests assigned to you.");

    const nav = within(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    );

    // Default pinned views render as children of "Views".
    expect(nav.getByRole("button", { name: "Assigned to me" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "Following" })).toBeTruthy();

    // Collapsing the "Views" group hides the pinned children.
    fireEvent.click(nav.getByRole("button", { name: "Collapse Views" }));
    expect(nav.queryByRole("button", { name: "Assigned to me" })).toBeNull();
    expect(nav.queryByRole("button", { name: "Following" })).toBeNull();
    // "Views" itself remains navigable.
    expect(nav.getByRole("button", { name: "Views" })).toBeTruthy();

    // Expanding restores them.
    fireEvent.click(nav.getByRole("button", { name: "Expand Views" }));
    expect(nav.getByRole("button", { name: "Assigned to me" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "Following" })).toBeTruthy();
  });

  it("searches commits and renders results", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
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
      await main.findByPlaceholderText("message, author, repository, SHA"),
      {
        target: { value: "commit" },
      },
    );
    fireEvent.change(await main.findByLabelText("From"), {
      target: { value: "2026-05-01" },
    });
    fireEvent.change(main.getByLabelText("To"), {
      target: { value: "2026-05-24" },
    });
    await main.findByText("Platform");
    fireEvent.change(await main.findByLabelText("Project"), {
      target: { value: "project-1" },
    });
    await main.findByText("azdo-dashboard");
    fireEvent.change(main.getByLabelText("Repository"), {
      target: { value: "repo-1" },
    });
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
          projectId: "project-1",
          repositoryId: "repo-1",
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

  it("validates commit date range before searching", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
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

  it("sorts my review rows by grid headers", async () => {
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

  it("navigates top-level sections", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));

    fireEvent.click(nav.getByRole("button", { name: "Views" }));
    expect(await main.findByRole("heading", { name: "Work Item Views" })).toBeTruthy();

    fireEvent.click(nav.getAllByRole("button", { name: "Search" })[1]);
    expect(await main.findByRole("heading", { name: "Work Items" })).toBeTruthy();

    fireEvent.click(nav.getByRole("button", { name: "Commits" }));
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();

    fireEvent.keyDown(window, { key: ",", altKey: true });
    expect(await main.findByRole("heading", { name: "Organizations" })).toBeTruthy();
  });

  it("navigates view history with Alt+Left and Alt+Right", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    fireEvent.click(nav.getByRole("button", { name: "Views" }));
    expect(await main.findByRole("heading", { name: "Work Item Views" })).toBeTruthy();
    fireEvent.click(nav.getByRole("button", { name: "Commits" }));
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();

    // Back: Commits -> Work Item Views -> My Reviews.
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(await main.findByRole("heading", { name: "Work Item Views" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    // Forward again restores the next view.
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    expect(await main.findByRole("heading", { name: "Work Item Views" })).toBeTruthy();
  });

  it("resizes navigation and review preview panes from keyboard handles", async () => {
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

  it("navigates between views with the G key chain", async () => {
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
        return Promise.resolve([]);
      }
      if (command === "list_my_work_items") {
        return Promise.resolve([]);
      }
      if (command === "list_commit_repositories") {
        return Promise.resolve([]);
      }
      if (command === "list_work_item_projects") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "w" });
    expect(await main.findByRole("heading", { name: "My Work Items" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "c" });
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "r" });
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();
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

  it("searches across entities from the command palette and opens a work item in app", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
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
          state: "all",
          workItemType: "",
          projectId: undefined,
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

  it("suppresses unbound WebView shortcuts (Ctrl+P / Ctrl+G) outside inputs", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
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
    await screen.findByRole("main");

    // fireEvent returns false when the handler called preventDefault, i.e. the
    // browser/WebView default (print dialog, find-next) was suppressed.
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(
      false,
    );
    expect(fireEvent.keyDown(document.body, { key: "g", ctrlKey: true })).toBe(
      false,
    );
    // Meta (Cmd) variant is suppressed too.
    expect(fireEvent.keyDown(document.body, { key: "p", metaKey: true })).toBe(
      false,
    );

    // Inside an editable target the keys keep their normal, un-suppressed path.
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(fireEvent.keyDown(input, { key: "p", ctrlKey: true })).toBe(true);
    input.remove();
  });
});
