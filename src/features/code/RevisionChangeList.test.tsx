import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RevisionChangeList } from "./RevisionChangeList";

afterEach(cleanup);

const changes = [
  { path: "/a.ts", changeType: "edit", originalPath: null },
  { path: "/b.ts", changeType: "add", originalPath: null },
  { path: "/c.ts", changeType: "rename", originalPath: "/old.ts" },
];

describe("RevisionChangeList", () => {
  it("counts the changed files and marks the selected one", () => {
    render(
      <RevisionChangeList changes={changes} truncated={false} selectedPath="/b.ts" onSelect={() => {}} />,
    );
    expect(screen.getByText("3 files changed")).toBeTruthy();
    const rows = screen.getAllByRole("button");
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    expect(rows[0].getAttribute("aria-current")).toBeNull();
    expect(rows[2].getAttribute("title")).toBe("/old.ts → /c.ts");
  });

  it("says when the server truncated the list", () => {
    render(
      <RevisionChangeList changes={changes} truncated selectedPath={null} onSelect={() => {}} />,
    );
    expect(screen.getByText(/list truncated by the server/)).toBeTruthy();
  });

  it("moves between files with the arrow keys and opens one with a click", () => {
    const onSelect = vi.fn();
    render(
      <RevisionChangeList changes={changes} truncated={false} selectedPath={null} onSelect={onSelect} />,
    );
    const rows = screen.getAllByRole("button");
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "End" });
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.click(rows[2]);
    expect(onSelect).toHaveBeenCalledWith("/c.ts");
  });
});
