import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PrLabelsRow } from "./PrLabelsRow";

const labels = [
  { id: "1", name: "bug" },
  { id: "2", name: "Needs Design" },
];

function renderRow(overrides: Partial<Parameters<typeof PrLabelsRow>[0]> = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(<PrLabelsRow labels={labels} busy={false} onAdd={onAdd} onRemove={onRemove} {...overrides} />);
  return { onAdd, onRemove };
}

afterEach(cleanup);

describe("PrLabelsRow", () => {
  it("shows the labels and removes one by its X", () => {
    const { onRemove } = renderRow();
    expect(screen.getByText("bug")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove label Needs Design"));
    expect(onRemove).toHaveBeenCalledWith(labels[1]);
  });

  it("adds a trimmed label with Enter and returns focus to the button", async () => {
    const { onAdd } = renderRow();
    fireEvent.click(screen.getByText("Label"));
    const input = screen.getByLabelText("New label name");
    fireEvent.change(input, { target: { value: "  ready  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith("ready");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText("Label").closest("button")),
    );
  });

  it("ignores a duplicate (case-insensitive) or empty name", () => {
    const { onAdd } = renderRow();
    fireEvent.click(screen.getByText("Label"));
    let input = screen.getByLabelText("New label name");
    fireEvent.change(input, { target: { value: "BUG" } });
    fireEvent.keyDown(input, { key: "Enter" });

    fireEvent.click(screen.getByText("Label"));
    input = screen.getByLabelText("New label name");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("cancels with Escape without adding", () => {
    const { onAdd } = renderRow();
    fireEvent.click(screen.getByText("Label"));
    const input = screen.getByLabelText("New label name");
    fireEvent.change(input, { target: { value: "ready" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New label name")).toBeNull();
  });
});
