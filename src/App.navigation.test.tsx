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

describe("App — Navigation", () => {
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

  it("navigates top-level sections", async () => {
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

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(await main.findByRole("heading", { name: "Connections" })).toBeTruthy();
  });

  it("navigates view history with Alt+Left and Alt+Right", async () => {
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

  it("navigates between views with the G key chain", async () => {
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

  it("suppresses unbound WebView shortcuts (Ctrl+P / Ctrl+G) outside inputs", async () => {
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

  it("reorders the top-level nav with Alt+ArrowUp and persists the order", async () => {
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    await screen.findByText("No pull requests assigned to you.");

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const order = () =>
      Array.from(nav.querySelectorAll("[data-nav-entry]")).map((el) =>
        el.getAttribute("data-nav-entry"),
      );

    expect(order()).toEqual(["pullRequests", "workItems", "pipelines", "codeSearch", "wiki"]);

    // Alt+ArrowUp on Pipelines swaps it above Work Items.
    fireEvent.keyDown(within(nav).getByRole("button", { name: "Pipelines" }), {
      key: "ArrowUp",
      altKey: true,
    });

    const expected = ["pullRequests", "pipelines", "workItems", "codeSearch", "wiki"];
    await waitFor(() => expect(order()).toEqual(expected));
    expect(
      JSON.parse(window.localStorage.getItem("azdodeck:layout:navOrder") ?? "null"),
    ).toEqual(expected);
  });

  it("restores a saved nav order from localStorage", async () => {
    window.localStorage.setItem(
      "azdodeck:layout:navOrder",
      JSON.stringify(["codeSearch", "pipelines", "workItems", "pullRequests"]),
    );
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
      if (command === "list_my_review_pull_requests") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    await screen.findByText("No pull requests assigned to you.");

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      Array.from(nav.querySelectorAll("[data-nav-entry]")).map((el) =>
        el.getAttribute("data-nav-entry"),
      ),
    ).toEqual(["codeSearch", "pipelines", "workItems", "pullRequests", "wiki"]);
  });
});
