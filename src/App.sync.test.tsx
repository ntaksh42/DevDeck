import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

describe("App — Sync", () => {
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

  it("refreshes synced data after manual sync completes", async () => {
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
});
