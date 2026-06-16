import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FilterableSelect, type SelectOption } from "./FilterableSelect";

afterEach(cleanup);

const options: SelectOption[] = [
  { value: "1", label: "CI" },
  { value: "2", label: "Nightly" },
  { value: "3", label: "Release" },
];

function setup(value = "") {
  const onChange = vi.fn();
  render(
    <FilterableSelect ariaLabel="Pipeline" value={value} options={options} onChange={onChange} />,
  );
  const input = screen.getByRole("combobox", { name: "Pipeline" });
  return { input, onChange };
}

describe("FilterableSelect", () => {
  it("opens on click and lists every option", () => {
    const { input } = setup();
    fireEvent.mouseDown(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("toggles closed on a second click", () => {
    const { input } = setup();
    fireEvent.mouseDown(input);
    expect(screen.queryByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters options as the user types", () => {
    const { input } = setup();
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: "nig" } });
    const visible = screen.getAllByRole("option");
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toBe("Nightly");
  });

  it("commits a selection on click and closes", () => {
    const { input, onChange } = setup();
    fireEvent.mouseDown(input);
    fireEvent.pointerDown(screen.getByText("Release"));
    expect(onChange).toHaveBeenCalledWith("3");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without committing", () => {
    const { input, onChange } = setup();
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: "rel" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes when a click lands outside the widget", () => {
    const { input } = setup();
    fireEvent.mouseDown(input);
    expect(screen.queryByRole("listbox")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selects the active option with the keyboard", () => {
    const { input, onChange } = setup();
    fireEvent.mouseDown(input);
    fireEvent.keyDown(input, { key: "ArrowDown" }); // CI -> Nightly
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("2");
  });
});
