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

  it("lists every option even when one is already selected", () => {
    // Regression: opening must not pre-filter the list down to the selection.
    const { input } = setup("2"); // Nightly selected
    fireEvent.mouseDown(input);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    // The selected label is surfaced via the placeholder, not by filtering.
    expect(input.getAttribute("placeholder")).toBe("Nightly");
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

  it("wires the combobox to the listbox for screen readers", () => {
    const { input } = setup();
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: no active option is announced.
    expect(input.getAttribute("aria-activedescendant")).toBeNull();

    fireEvent.mouseDown(input);
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(listbox.id).toBeTruthy();
  });

  it("tracks the active option via aria-activedescendant as it moves", () => {
    const { input } = setup();
    fireEvent.mouseDown(input);
    const optionEls = screen.getAllByRole("option");
    // Opens highlighting the first option.
    expect(input.getAttribute("aria-activedescendant")).toBe(optionEls[0].id);
    expect(optionEls[0].id).toBeTruthy();

    fireEvent.keyDown(input, { key: "ArrowDown" }); // CI -> Nightly
    expect(input.getAttribute("aria-activedescendant")).toBe(optionEls[1].id);
  });

  it("without allowCustomValue, Enter on unmatched text does not commit", () => {
    const { input, onChange } = setup();
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: "release/9.9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeTruthy();
  });

  describe("allowCustomValue", () => {
    function setupCustom(value = "") {
      const onChange = vi.fn();
      render(
        <FilterableSelect
          ariaLabel="Branch"
          value={value}
          options={options}
          onChange={onChange}
          allowCustomValue
        />,
      );
      const input = screen.getByRole("combobox", { name: "Branch" });
      return { input, onChange };
    }

    it("commits typed text that matches no option on Enter", () => {
      const { input, onChange } = setupCustom();
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: "release/9.9" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("release/9.9");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("commits typed text when a click lands outside the widget", () => {
      const { input, onChange } = setupCustom();
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: "hotfix/1" } });
      fireEvent.pointerDown(document.body);
      expect(onChange).toHaveBeenCalledWith("hotfix/1");
    });

    it("still picks a matching option instead of the raw text", () => {
      const { input, onChange } = setupCustom();
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: "nightly" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onChange).toHaveBeenCalledWith("2");
    });

    it("closes on Escape without committing the typed text", () => {
      const { input, onChange } = setupCustom();
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: "release/9.9" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("displays a custom value that isn't in the option list", () => {
      const { input } = setupCustom("release/9.9");
      expect((input as HTMLInputElement).value).toBe("release/9.9");
    });
  });
});
