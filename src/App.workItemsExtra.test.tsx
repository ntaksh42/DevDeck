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

describe("App — Work Items (extra)", () => {
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
      if (command === "get_active_organization") {
        return Promise.resolve(organization);
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
});
