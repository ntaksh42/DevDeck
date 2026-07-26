import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkActionBar } from "./BulkActionBar";

// This project does not enable vitest globals, so RTL's automatic cleanup
// isn't registered; unmount explicitly between tests.
afterEach(cleanup);

/**
 * Drives the bar with real open/close state so closing a popover actually
 * unmounts its options, which is what strands focus in the real app.
 */
function Harness() {
  const [stateOpen, setStateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  return (
    <BulkActionBar
      count={2}
      typeBreakdown={[]}
      stateBreakdown={[]}
      onClear={vi.fn()}
      stateOpen={stateOpen}
      onStateOpenChange={setStateOpen}
      stateOptions={["Active", "Closed"]}
      stateLoading={false}
      statePending={false}
      onStateSelect={vi.fn()}
      assignOpen={assignOpen}
      onAssignOpenChange={setAssignOpen}
      assignQuery=""
      onAssignQueryChange={vi.fn()}
      assignOptions={[]}
      assignLoading={false}
      assignPending={false}
      onAssignSelect={vi.fn()}
      priorityOpen={priorityOpen}
      onPriorityOpenChange={setPriorityOpen}
      priorityPending={false}
      onPrioritySelect={vi.fn()}
      tagsPending={false}
      onTagsApply={vi.fn()}
      snoozePending={false}
      onSnoozeOpen={vi.fn()}
    />
  );
}

describe("BulkActionBar popover focus", () => {
  // Regression: Escape closed the popover but left focus on <body>, so the
  // grid stopped responding to j/k until the user tabbed in from the top.
  it.each([
    ["State", "Closed"],
    ["Priority", "3"],
  ])("returns focus to the %s trigger when Escape closes it", (trigger, option) => {
    render(<Harness />);
    // Grab the trigger before opening: once open, the option list adds buttons
    // whose names would also match a loose selector.
    const triggerButton = screen.getByRole("button", { name: trigger });

    fireEvent.click(triggerButton);
    const optionButton = screen.getByRole("button", { name: option });
    optionButton.focus();
    expect(document.activeElement).toBe(optionButton);

    fireEvent.keyDown(optionButton, { key: "Escape" });

    expect(screen.queryByRole("button", { name: option })).toBeNull();
    expect(document.activeElement).toBe(triggerButton);
  });

  it("returns focus to the Assignee trigger when Escape closes the search box", () => {
    render(<Harness />);
    const triggerButton = screen.getByRole("button", { name: "Assignee" });

    fireEvent.click(triggerButton);
    const search = screen.getByPlaceholderText("Search assignee...");
    search.focus();

    fireEvent.keyDown(search, { key: "Escape" });

    expect(screen.queryByPlaceholderText("Search assignee...")).toBeNull();
    expect(document.activeElement).toBe(triggerButton);
  });

  it("keeps Escape from reaching the grid behind the popover", () => {
    const onGridKeyDown = vi.fn();
    render(
      <div onKeyDown={onGridKeyDown}>
        <Harness />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "State" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Closed" }), { key: "Escape" });

    expect(onGridKeyDown).not.toHaveBeenCalled();
  });
});
