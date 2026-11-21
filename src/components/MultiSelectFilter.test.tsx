import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MultiSelectFilter } from "./MultiSelectFilter";

afterEach(cleanup);

function mount() {
  const onChange = vi.fn();
  const onKeyDown = vi.fn();
  render(<form onKeyDown={onKeyDown}>
    <MultiSelectFilter options={[{ value: "a", label: "Alpha" }]} selected={[]}
      onChange={onChange} placeholder="All values" ariaLabel="Choose values" searchable />
  </form>);
  return { onChange, onKeyDown, trigger: screen.getByRole("button", { name: "Choose values" }) };
}

it("prevents Enter in the option search from submitting its parent form", () => {
  const { trigger, onKeyDown, onChange } = mount();
  fireEvent.click(trigger);
  const input = screen.getByPlaceholderText("Search…");
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  expect(onKeyDown).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

it("does not open the filter while Enter confirms an IME composition", () => {
  const { trigger } = mount();
  fireEvent.keyDown(trigger, { key: "Enter", isComposing: true });
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("does not toggle an option while Enter confirms an IME composition", () => {
  const { trigger, onChange } = mount();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("option", { name: "Alpha" }), { key: "Enter", isComposing: true });
  expect(onChange).not.toHaveBeenCalled();
});

it("still selects an option with a normal Enter", () => {
  const { trigger, onChange } = mount();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("option", { name: "Alpha" }), { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith(["a"]);
});
