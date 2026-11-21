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

const inboxItem = {
  id: 1,
  organizationId: "contoso",
  kind: "pr_mention",
  subjectId: 7,
  projectId: "proj",
  projectName: "Platform",
  repositoryId: "repo",
  repositoryName: "api",
  threadId: 70,
  commentId: 700,
  title: "Add retry",
  author: "Tanaka",
  snippet: "@you please check",
  webUrl: "https://dev.azure.com/contoso/Platform/_git/api/pullrequest/7",
  state: "open",
  snoozedUntil: null,
  detectedAt: "2026-10-10T10:00:00Z",
  doneAt: null,
};

const review = {
  pullRequestId: 7,
  title: "Add retry",
  description: null,
  sourceRefName: "refs/heads/feature/retry",
  targetRefName: "refs/heads/main",
  createdBy: "Tanaka",
  creationDate: "2026-10-10T09:00:00Z",
  isDraft: false,
  reviewers: [],
  threads: [
    {
      id: 70,
      status: "active",
      isResolved: false,
      filePath: "src/retry.rs",
      rightLine: 12,
      comments: [
        {
          id: 700,
          parentCommentId: null,
          content: "@you please check https://example.com/spec",
          author: "Tanaka",
          publishedDate: "2026-10-10T10:00:00Z",
          isSystem: false,
          isMine: false,
        },
      ],
    },
  ],
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
  if (command === "get_unread_notifications_count") return 0;
  if (command === "get_action_inbox_counts") return { open: 2, snoozed: 0, done: 1 };
  if (command === "list_action_inbox_items") return [inboxItem];
  if (command === "get_pull_request_review") return review;
  return undefined;
}

describe("App — Inbox", () => {
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

  it("shows the open count in the sidebar and opens the Inbox from the nav", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "Pull Requests My Reviews" })).toBeTruthy();

    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    fireEvent.click(await nav.findByRole("button", { name: "Inbox, 2" }));

    expect(await main.findByRole("heading", { name: "Inbox" })).toBeTruthy();
    const list = await main.findByRole("listbox", { name: "Inbox items" });
    await waitFor(() => {
      expect(within(list).getAllByRole("option")).toHaveLength(1);
    });
    // The thread loads from the shared review cache and shows its file context.
    expect(await main.findByText("src/retry.rs:12")).toBeTruthy();
  });

  it("counts only stored items in the sidebar badge, not approvals or agent replies", async () => {
    const baseline = baseInvoke;
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === "get_provider_capabilities") {
        return Promise.resolve({ capabilities: { pipelines: true } });
      }
      if (command === "list_pipeline_projects") {
        return Promise.resolve([{ id: "p1", name: "Tooling" }]);
      }
      if (command === "list_pipeline_approvals") {
        return Promise.resolve([
          {
            id: "a1",
            status: "pending",
            instructions: "Approve to deploy",
            minRequiredApprovers: 1,
            executionOrder: null,
            createdOn: null,
            assignedApprovers: [],
          },
        ]);
      }
      if (command === "summarize_agent_notes") {
        const target = (args as { input?: { target?: string } } | undefined)?.input?.target;
        return Promise.resolve(
          target === "pull-request"
            ? [
                {
                  itemId: 7,
                  open: 1,
                  needsYou: 1,
                  drafts: 0,
                  done: 0,
                  lastAgentReplyAt: null,
                  lastModifiedAt: null,
                },
              ]
            : [],
        );
      }
      const result = baseline(command);
      return result !== undefined || command === "trigger_sync"
        ? Promise.resolve(result)
        : Promise.reject(new Error(`Unhandled command: ${command}`));
    });

    renderApp();
    const nav = within(await screen.findByRole("navigation", { name: "Primary navigation" }));
    // Approvals and agent replies live in Pipelines and the Agent panel.
    expect(await nav.findByRole("button", { name: "Inbox, 2" })).toBeTruthy();
  });

  it("navigates to the Inbox with the g i key chain", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "Pull Requests My Reviews" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "i" });
    expect(await main.findByRole("heading", { name: "Inbox" })).toBeTruthy();
  });

  it("moved Work Item Search to the g f key chain", async () => {
    renderApp();
    const main = within(await screen.findByRole("main"));
    expect(await main.findByRole("heading", { name: "Pull Requests My Reviews" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "f" });
    expect(await main.findByRole("heading", { name: "Work Items Search" })).toBeTruthy();
  });
});
