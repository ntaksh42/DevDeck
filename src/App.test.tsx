import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.fn();
const openUrlMock = vi.fn();

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
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string | URL) => openUrlMock(url),
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
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openUrlMock.mockReset();
    window.localStorage.clear();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: null });
      }
      if (command === "get_review_result_preview") {
        return Promise.resolve(null);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
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
    expect(invokeMock).toHaveBeenCalledTimes(1);
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

  it("saves review result folder settings", async () => {
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "list_organizations") {
        return Promise.resolve([organization]);
      }
      if (command === "get_app_settings") {
        return Promise.resolve({ reviewResultFolderPath: null });
      }
      if (command === "update_app_settings") {
        return Promise.resolve(
          (args as { input: { reviewResultFolderPath: string } }).input,
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
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("update_app_settings", {
        input: {
          reviewResultFolderPath: "D:\\azdo-review-results",
        },
      });
    });
    expect(await screen.findByText("Review result folder saved.")).toBeTruthy();
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
        return Promise.resolve([
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
            sourceRefName: "feature/pr-search",
            targetRefName: "main",
            webUrl: "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
          },
        ]);
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.keyDown(window, { key: "2", altKey: true });

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
        },
      });
    });
    expect(await screen.findByText("Add pull request search")).toBeTruthy();
    expect(screen.getByText("Platform / azdo-dashboard")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "#42" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_git/repo/pullrequest/42",
      );
    });
  });

  it("searches work items and renders results", async () => {
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
        return Promise.resolve({
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 123,
          title: "Fix save workflow",
          workItemType: "Bug",
          state: "Active",
          assignedTo: "Test User",
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
              id: 7,
              text: "Earlier context",
              renderedText: "<p>Earlier context</p>",
              createdBy: "Creator",
              createdById: "user-creator",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T12:00:00Z",
            },
          ],
        });
      }
      if (command === "search_work_item_mentions") {
        return Promise.resolve([
          {
            id: "user-creator",
            displayName: "Creator",
            uniqueName: "creator@example.com",
          },
        ]);
      }
      if (command === "assign_work_item") {
        return Promise.resolve({
          organizationId: "contoso",
          projectId: "project-1",
          projectName: "Platform",
          id: 123,
          title: "Fix save workflow",
          workItemType: "Bug",
          state: "Active",
          assignedTo: "Creator",
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
              createdById: "user-creator",
              createdByUniqueName: "creator@example.com",
              createdDate: "2026-05-23T12:00:00Z",
            },
          ],
        });
      }
      if (command === "add_work_item_comment") {
        return Promise.resolve({
          id: 1,
          text: "@<user-creator> please check",
          renderedText: "<p>@Creator please check</p>",
          createdBy: "Test User",
          createdDate: "2026-05-24T00:00:00Z",
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.keyDown(window, { key: "4", altKey: true });
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
    });
    expect((await screen.findAllByText("Fix save workflow")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Test User").length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Comment")).toBeTruthy();
    expect(screen.getAllByTitle("Fix save workflow").length).toBeGreaterThan(1);
    const previewLabels = [...document.querySelectorAll("dt")].map((node) =>
      node.textContent?.trim(),
    );
    expect(previewLabels).not.toContain("Author");
    expect(previewLabels).not.toContain("Created");
    expect(previewLabels).not.toContain("Changed");
    const descriptionFrame = document.querySelector(
      'iframe[title="Description"]',
    ) as HTMLIFrameElement | null;
    expect(descriptionFrame).toBeTruthy();
    expect(descriptionFrame?.getAttribute("scrolling")).toBe("no");
    expect(descriptionFrame?.style.maxHeight).toBe("");

    const workItemsGrid = screen.getByRole("grid", { name: "Work items" });
    fireEvent.keyDown(workItemsGrid, { key: "a" });
    expect(await screen.findByPlaceholderText("Search assignee...")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /creator@example.com/ }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("assign_work_item", {
        input: {
          organizationId: "contoso",
          projectId: "project-1",
          workItemId: 123,
          assignedTo: "creator@example.com",
        },
      });
    });

    fireEvent.keyDown(workItemsGrid, { key: "m" });
    const commentBox = screen.getByLabelText("Comment");
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
          markdown: "@<user-creator> please check",
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "#123" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://dev.azure.com/contoso/project/_workitems/edit/123",
      );
    });
  });

  it("saves a work item view and renders query results with preview", async () => {
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
        return Promise.resolve([
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
        ]);
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
    fireEvent.keyDown(window, { key: "7", altKey: true });
    await main.findByText("Query View");
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
        },
      });
    });
    expect((await screen.findAllByText("Fix view query workflow")).length).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Comment")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Active Bugs/ })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Saved work item views" })).toBeTruthy();
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
        return Promise.resolve([
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
        ]);
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
    expect(await screen.findByText("Add commit search")).toBeTruthy();
    expect(screen.getByText("abcdef12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "abcdef12" }));

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

  it("filters my reviews by waiting author and opens the selected row by keyboard", async () => {
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
    expect(await main.findByText("Needs review")).toBeTruthy();
    expect(main.queryByRole("tab", { name: "Rejected" })).toBeNull();

    fireEvent.keyDown(main.getByRole("grid", { name: "My review pull requests" }), {
      key: "3",
    });

    expect(await main.findByText("Waiting on author")).toBeTruthy();
    expect(main.queryByText("Needs review")).toBeNull();
    expect(main.queryByText("Rejected legacy path")).toBeNull();
    expect(await main.findByText("review-PR102.html")).toBeTruthy();

    fireEvent.keyDown(main.getByRole("grid", { name: "My review pull requests" }), {
      key: "Enter",
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

  it("navigates top-level sections with keyboard shortcuts", async () => {
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

    fireEvent.keyDown(window, { key: "4", altKey: true });
    expect(await main.findByRole("heading", { name: "Work Items" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "5", altKey: true });
    expect(await main.findByRole("heading", { name: "Commits" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "6", altKey: true });
    expect(await main.findByRole("heading", { name: "Organizations" })).toBeTruthy();
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

  it("runs in browser preview mode without Tauri internals", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    renderApp();
    const main = within(await screen.findByRole("main"));

    expect(await main.findByRole("heading", { name: "My Reviews" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "2", altKey: true });

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
});
