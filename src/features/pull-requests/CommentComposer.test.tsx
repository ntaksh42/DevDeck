import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentComposer } from "./CommentComposer";
import type { MentionCandidate } from "@/lib/azdoCommands";
import { PULL_REQUEST_COMMENT_HEIGHT_STORAGE_KEY } from "@/lib/usePersistedTextareaHeight";

const candidate: MentionCandidate = {
  id: "11111111-2222-3333-4444-555555555555",
  displayName: "田中太郎",
  uniqueName: "tanaka@contoso.example",
};

describe("CommentComposer mentions", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("allows vertical resizing", () => {
    window.localStorage.setItem(PULL_REQUEST_COMMENT_HEIGHT_STORAGE_KEY, "180");
    render(<CommentComposer placeholder="Reply…" onSubmit={async () => {}} />);

    const textarea = screen.getByRole("textbox");
    expect(textarea.className).toContain("resize-y");
    expect(textarea.style.height).toBe("180px");
  });

  it("opens the mention picker for a non-ASCII display name", async () => {
    const mentionSearch = vi.fn().mockResolvedValue([candidate]);
    render(
      <CommentComposer
        placeholder="Reply…"
        onSubmit={async () => {}}
        mentionSearch={mentionSearch}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "@田中" } });

    expect(await screen.findByText("田中太郎")).toBeTruthy();
    expect(mentionSearch).toHaveBeenCalledWith("田中");
  });

  it("converts a selected mention to Azure DevOps @<guid> markdown on submit", async () => {
    const mentionSearch = vi.fn().mockResolvedValue([candidate]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentComposer
        placeholder="Reply…"
        onSubmit={onSubmit}
        mentionSearch={mentionSearch}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "@田中" } });

    const option = await screen.findByText("田中太郎");
    fireEvent.mouseDown(option);

    expect((textarea as HTMLTextAreaElement).value).toBe("@田中太郎 ");

    fireEvent.change(textarea, {
      target: { value: "@田中太郎 thanks!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(onSubmit).toHaveBeenCalledWith(
      `@<${candidate.id}> thanks!`,
    );
  });
});
