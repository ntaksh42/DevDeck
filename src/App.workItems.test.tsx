import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "./test/appTestHelpers";
import { workItemsSearchInvoke } from "./test/workItemsInvoke";

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

describe("App — Work Items", () => {
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

  it("searches work items and renders results", async () => {
    invokeMock.mockImplementation(workItemsSearchInvoke);

    renderApp();
    const main = within(await screen.findByRole("main"));

    await screen.findByText("No pull requests assigned to you.");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getAllByRole("button", { name: "Search" })[1]);
    // Projects load into the multi-select project filter; opening it reveals them.
    const projectFilter = await main.findByRole("button", { name: "Filter by project" });
    await waitFor(() => expect(projectFilter.hasAttribute("disabled")).toBe(false));
    fireEvent.click(projectFilter);
    await main.findByRole("option", { name: "Platform" });
    fireEvent.click(projectFilter);
    fireEvent.change(await main.findByPlaceholderText("Search work items…"), {
      target: { value: "save" },
    });
    fireEvent.click(main.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("search_work_items", {
        input: {
          organizationId: "contoso",
          query: "save",
          states: undefined,
          workItemTypes: undefined,
          projectIds: undefined,
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
    // Posting hands focus back to the preview panel so keyboard flow resumes.
    expect(document.activeElement).toBe(screen.getByLabelText("Work item preview"));
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
    expect(commentBox.className).toContain("resize-y");
    expect(document.activeElement).toBe(commentBox);
    (commentBox as HTMLTextAreaElement).blur();
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    expect(document.activeElement).toBe(commentBox);
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    expect(document.activeElement?.getAttribute("role")).toBe("row");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
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
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    expect(document.activeElement?.getAttribute("role")).toBe("row");
    fireEvent.keyDown(document.activeElement ?? workItemsGrid, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
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
});
