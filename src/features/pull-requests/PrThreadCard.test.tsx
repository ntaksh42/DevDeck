import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrThreadCard } from "./PrThreadCard";
import type { PrThread } from "@/lib/azdoCommands";

const thread: PrThread = {
  id: 1,
  status: "active",
  isResolved: false,
  filePath: null,
  rightLine: null,
  leftLine: null,
  comments: [
    {
      id: 10,
      parentCommentId: null,
      content: "Looks good",
      author: "Reviewer",
      publishedDate: "2026-06-20T00:00:00Z",
      isSystem: false,
      isMine: true,
    },
  ],
};

function renderInPreview() {
  render(
    <div data-primary-preview="true" tabIndex={-1}>
      <PrThreadCard
        thread={thread}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={() => {}}
        onEditComment={async () => {}}
        onDeleteComment={() => {}}
      />
    </div>,
  );
  return document.querySelector<HTMLElement>("[data-primary-preview='true']")!;
}

describe("PrThreadCard focus restoration", () => {
  afterEach(cleanup);

  it("returns focus to the preview pane when the reply composer is cancelled", () => {
    const preview = renderInPreview();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    // The composer autofocuses its textarea while open.
    expect(document.activeElement).toBe(screen.getByRole("textbox"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // On close, focus must land back on the preview pane (not <body>) so
    // keyboard navigation resumes.
    expect(document.activeElement).toBe(preview);
  });

  it("returns focus to the preview pane when the edit composer is cancelled", () => {
    const preview = renderInPreview();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(preview);
  });
});
