import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { focusFilterInput } from "@/lib/utils";
import { WorkItemFilterBar } from "./WorkItemFilterBar";

function Harness() {
  const [value, setValue] = useState("");
  return <WorkItemFilterBar value={value} onChange={setValue} />;
}

describe("WorkItemFilterBar", () => {
  afterEach(cleanup);

  it("opens focused on Ctrl+F, folds on Escape and keeps the value as a chip", () => {
    render(<Harness />);
    expect(screen.queryByRole("textbox", { name: "Filter" })).toBeNull();

    act(() => {
      focusFilterInput();
    });
    const input = screen.getByRole("textbox", { name: "Filter" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "s:active" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Filter" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear “s:active”" }));
    expect(screen.queryByRole("button", { name: "Clear “s:active”" })).toBeNull();
  });
});
