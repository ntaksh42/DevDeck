import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

describe("App — Settings", () => {
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

  it("saves review result folder settings", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
});
