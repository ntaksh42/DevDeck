import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function makeThread(overrides: Partial<PrThread> = {}): PrThread {
  return {
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
        author: "Alice",
        publishedDate: "2026-06-24T00:00:00Z",
        isSystem: false,
        isMine: false,
      },
    ],
    ...overrides,
  };
}

function renderInPreview() {
  render(
    <div data-primary-preview="true" tabIndex={-1}>
      <PrThreadCard
        thread={thread}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={() => {}}
        onEditComment={async () => {}}
        onDeleteComment={async () => {}}
      />
    </div>,
  );
  return document.querySelector<HTMLElement>("[data-primary-preview='true']")!;
}

describe("PrThreadCard focus restoration", () => {
  afterEach(cleanup);

  it("returns focus to the preview pane when the reply composer is cancelled", () => {
    const preview = renderInPreview();
    // The always-visible "Write a reply…" row expands into the composer.
    fireEvent.click(screen.getByRole("button", { name: "Write a reply…" }));
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

describe("PrThreadCard resolve toggle", () => {
  afterEach(cleanup);

  it("shows the Resolve button next to the reply row for a thread without a status (#434)", () => {
    const onToggleStatus = vi.fn();
    render(
      <PrThreadCard
        thread={makeThread({ status: null })}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={onToggleStatus}
      />,
    );
    const button = screen.getByRole("button", { name: "Resolve" });
    fireEvent.click(button);
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
  });

  it("shows Reactivate for a resolved status-less thread", () => {
    render(
      <PrThreadCard
        thread={makeThread({ status: null, isResolved: true })}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy();
  });
});

describe("PrThreadCard status dropdown", () => {
  afterEach(cleanup);

  it("opens focused on the first option, selects Resolved with the keyboard, and returns focus to the trigger", () => {
    const onToggleStatus = vi.fn();
    render(
      <PrThreadCard
        thread={makeThread()}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={onToggleStatus}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Active" });
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Active", "Resolved"]);
    // Opens focused on the first option.
    expect(document.activeElement).toBe(options[0]);

    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);

    fireEvent.click(options[1]);
    expect(onToggleStatus).toHaveBeenCalledTimes(1);
    // Closing returns focus to the trigger.
    expect(document.activeElement).toBe(trigger);
  });

  it("does not call onToggleStatus when the currently-selected option is re-picked", () => {
    const onToggleStatus = vi.fn();
    render(
      <PrThreadCard
        thread={makeThread()}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={onToggleStatus}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(onToggleStatus).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(
      <PrThreadCard
        thread={makeThread()}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Active" });
    fireEvent.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.keyDown(screen.getAllByRole("option")[0], { key: "Escape" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });
});

describe("PrThreadCard collapse toggle", () => {
  afterEach(cleanup);

  it("shows only the first author and a one-line summary when collapsed", () => {
    render(
      <PrThreadCard
        thread={makeThread()}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={() => {}}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Collapse thread" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Looks good")).toBeTruthy();
    // The reply row and per-comment Edit action are hidden while collapsed.
    expect(screen.queryByRole("button", { name: "Write a reply…" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand thread" }));
    expect(screen.getByRole("button", { name: "Write a reply…" })).toBeTruthy();
  });
});

describe("PrThreadCard avatars", () => {
  afterEach(cleanup);

  it("renders an initials avatar per comment", () => {
    render(
      <PrThreadCard
        thread={makeThread()}
        busy={false}
        onReply={async () => {}}
        onToggleStatus={() => {}}
      />,
    );
    expect(screen.getByText("AL")).toBeTruthy();
  });
});
