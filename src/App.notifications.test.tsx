import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organization, renderApp } from "./test/appTestHelpers";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const notificationRecord = {
  id: 1,
  createdAt: "2026-07-10T10:00:00Z",
  organizationId: "contoso",
  kind: "wiAssigned",
  title: "Assigned: #123",
  body: "A work item was assigned to you.\nDemo Project / contoso",
  payload: { workItemId: 123, projectName: "Demo Project", state: "Active", previousState: null, webUrl: null },
  isRead: false,
};

function baseInvoke(command: string): unknown {
  if (command === "list_organizations") return [organization];
  if (command === "get_active_organization") return organization;
  if (command === "get_app_settings") return { reviewResultFolderPath: null };
  if (command === "get_review_result_preview") return null;
  if (command === "list_sync_states") return [];
  if (command === "trigger_sync") return undefined;
  if (command === "list_my_review_pull_requests") return [];
  if (command === "list_my_work_items") return [];
  if (command === "get_unread_notifications_count") return 3;
  if (command === "list_notifications") return { items: [notificationRecord], hasMore: false };
  return undefined;
}

describe("App — Notifications", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((command: string) => {
      const result = baseInvoke(command);
      if (result !== undefined || command === "trigger_sync") return Promise.resolve(result);
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    cleanup();
  });

  it("shows the unread badge in the sidebar and opens the view from the nav", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    const notificationsButton = await nav.findByRole("button", { name: "Notifications, 3" });

    fireEvent.click(notificationsButton);
    expect(await main.findByRole("heading", { name: "Notifications" })).toBeTruthy();
    await waitFor(() => {
      expect(main.getByRole("grid", { name: "Notifications" })).toBeTruthy();
    });
  });

  it("navigates to Notifications with the g n key chain", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "n" });
    expect(await main.findByRole("heading", { name: "Notifications" })).toBeTruthy();
  });
});
