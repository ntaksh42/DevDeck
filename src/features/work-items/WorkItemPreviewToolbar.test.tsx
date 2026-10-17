import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemPreview } from "@/lib/azdoCommands";
import { WorkItemPreviewToolbar } from "./WorkItemPreviewToolbar";

const follow = vi.hoisted(() => ({ isFollowed: true, toggleFollow: vi.fn(), pending: false }));
vi.mock("./useWorkItemFollow", () => ({ useWorkItemFollow: () => follow }));
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listWorkItemFields: vi.fn().mockResolvedValue([]),
}));

afterEach(() => {
  cleanup();
  follow.toggleFollow.mockClear();
});

function renderToolbar(overrides: { onDuplicate?: (() => void) | null; sideBySide?: boolean } = {}) {
  const onToggleCommentsLayout = vi.fn();
  const onZoomIn = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkItemPreviewToolbar
        preview={{ id: 7, title: "Fix it", organizationId: "o", projectId: "p" } as unknown as WorkItemPreview}
        onDuplicate={overrides.onDuplicate === undefined ? vi.fn() : overrides.onDuplicate}
        zoom={{
          zoom: 1,
          canZoomIn: true,
          canZoomOut: true,
          onZoomIn,
          onZoomOut: vi.fn(),
          onResetZoom: vi.fn(),
        }}
        presets={{
          canSave: false,
          onApply: vi.fn(),
          onDelete: vi.fn(),
          onSave: vi.fn(),
          presets: [],
          stagedCount: 0,
        }}
        sideBySide={overrides.sideBySide ?? false}
        onToggleCommentsLayout={onToggleCommentsLayout}
        fieldConfig={{
          organizationId: "o",
          projectId: "p",
          selectedFieldKeys: [],
          onSelectedFieldKeysChange: vi.fn(),
          customPreviewFields: [],
          onCustomPreviewFieldsChange: vi.fn(),
        }}
      />
    </QueryClientProvider>,
  );
  return { onToggleCommentsLayout, onZoomIn };
}

describe("WorkItemPreviewToolbar", () => {
  it("shows only zoom and the View options menu in the tab strip", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: "Zoom in preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View options" })).toBeTruthy();
    for (const name of ["Email a link", "Duplicate work item", "Configure preview fields", "Field presets"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("lists every action in the menu with the toggle state, driven by the keyboard", () => {
    const { onToggleCommentsLayout } = renderToolbar({ sideBySide: false });
    const trigger = screen.getByRole("button", { name: "View options" });
    fireEvent.click(trigger);

    const followItem = screen.getByRole("menuitemcheckbox", { name: "Follow" });
    expect(followItem.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(followItem);
    expect(screen.getByRole("menuitemcheckbox", { name: "Comments beside details" }).getAttribute("aria-checked")).toBe(
      "false",
    );

    // ↓ walks Follow -> Email -> Duplicate -> Create branch -> Presets -> Comments layout.
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const layout = screen.getByRole("menuitemcheckbox", { name: "Comments beside details" });
    expect(document.activeElement).toBe(layout);
    fireEvent.click(layout);
    expect(onToggleCommentsLayout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Follow" }));
    expect(follow.toggleFollow).toHaveBeenCalledTimes(1);
  });

  it("opens the branch dialog from the command palette event", async () => {
    renderToolbar();
    window.dispatchEvent(new CustomEvent("azdodeck:work-items:create-branch"));
    expect(await screen.findByRole("dialog", { name: /Create branch/ })).toBeTruthy();
  });

  it("omits Duplicate when the host cannot duplicate", () => {
    renderToolbar({ onDuplicate: null });
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    expect(screen.queryByRole("menuitem", { name: /Duplicate/ })).toBeNull();
  });

  it("opens a popover from the menu and returns focus to the trigger on Escape", async () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "View options" });
    fireEvent.click(trigger);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Field presets/ }));
    });
    const name = screen.getByText("Field presets");
    expect(name).toBeTruthy();
    expect(screen.getByText(/Stage changes/)).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(screen.getByText("Field presets"), { key: "Escape" });
    });
    expect(screen.queryByText("Field presets")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
