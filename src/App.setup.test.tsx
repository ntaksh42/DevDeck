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

describe("App — Setup", () => {
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
});
