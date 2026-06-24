import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrThreadCard } from "./PrThreadCard";
import type { PrThread } from "@/lib/azdoCommands";

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

describe("PrThreadCard resolve toggle", () => {
  afterEach(cleanup);

  it("shows the Resolve toggle for a thread without a status (#434)", () => {
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
