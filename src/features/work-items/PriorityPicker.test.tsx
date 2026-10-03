import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PriorityPicker, StatePicker } from "./PreviewEditorsPickers";

const noop = () => {};

afterEach(cleanup);

describe("PriorityPicker", () => {
  it("shows a priority-colored dot before the value", () => {
    render(
      <PriorityPicker current="1" onOpenChange={noop} onSelect={noop} open={false} pending={false} />,
    );
    const trigger = screen.getByRole("button", { name: "Change priority" });
    expect(trigger.textContent).toBe("1");
    expect(trigger.querySelector("span.bg-red-500")).not.toBeNull();
  });

  it("shows no dot when priority is unset", () => {
    render(
      <PriorityPicker current={null} onOpenChange={noop} onSelect={noop} open={false} pending={false} />,
    );
    const trigger = screen.getByRole("button", { name: "Change priority" });
    expect(trigger.querySelector("span[aria-hidden]")).toBeNull();
  });

  it("does not add a priority dot to the state picker", () => {
    render(
      <StatePicker
        current="Active"
        loading={false}
        onOpenChange={noop}
        onSelect={noop}
        open={false}
        options={[]}
        pending={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: /state/i });
    expect(trigger.querySelector("span[aria-hidden]")).toBeNull();
  });
});
