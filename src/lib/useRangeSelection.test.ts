import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRangeSelection } from "./useRangeSelection";

type Row = { id: string; webUrl: string };

const rows: Row[] = [
  { id: "a", webUrl: "https://example.test/a" },
  { id: "b", webUrl: "https://example.test/b" },
  { id: "c", webUrl: "https://example.test/c" },
  { id: "d", webUrl: "https://example.test/d" },
];

function render(initialRows: Row[] = rows, selectedIndex = 0) {
  return renderHook(
    (props: { rows: Row[]; selectedIndex: number }) =>
      useRangeSelection({ rows: props.rows, keyOf: (row) => row.id, selectedIndex: props.selectedIndex }),
    { initialProps: { rows: initialRows, selectedIndex } },
  );
}

describe("useRangeSelection", () => {
  it("falls back to the focused row when nothing is explicitly selected", () => {
    const { result } = render(rows, 2);
    expect(result.current.selectedRows.map((row) => row.id)).toEqual(["c"]);
    expect(result.current.isMultiSelect).toBe(false);
  });

  it("extends a range from the focused row to the shift target", () => {
    const { result } = render(rows, 1);
    act(() => result.current.extendTo(3));
    expect([...result.current.selectedKeys].sort()).toEqual(["b", "c", "d"]);
    expect(result.current.isMultiSelect).toBe(true);
  });

  it("extends upward when the target is above the anchor", () => {
    const { result } = render(rows, 3);
    act(() => result.current.extendTo(1));
    expect([...result.current.selectedKeys].sort()).toEqual(["b", "c", "d"]);
  });

  it("keeps the original anchor across successive extends", () => {
    const { result } = render(rows, 1);
    act(() => result.current.extendTo(2));
    act(() => result.current.extendTo(3));
    expect([...result.current.selectedKeys].sort()).toEqual(["b", "c", "d"]);
  });

  it("ctrl-toggle seeds the selection with the focused row before adding", () => {
    const { result } = render(rows, 0);
    act(() => result.current.toggleAt(2));
    expect([...result.current.selectedKeys].sort()).toEqual(["a", "c"]);
  });

  it("ctrl-toggle removes an already selected row", () => {
    const { result } = render(rows, 0);
    act(() => result.current.toggleAt(2));
    act(() => result.current.toggleAt(2));
    expect([...result.current.selectedKeys].sort()).toEqual(["a"]);
  });

  it("drops keys whose rows disappeared from the list", () => {
    const { result, rerender } = render(rows, 0);
    act(() => result.current.extendTo(3));
    rerender({ rows: rows.slice(0, 2), selectedIndex: 0 });
    expect([...result.current.selectedKeys].sort()).toEqual(["a", "b"]);
  });

  it("clears the selection and the anchor", () => {
    const { result } = render(rows, 0);
    act(() => result.current.extendTo(2));
    act(() => result.current.clear());
    expect(result.current.selectedKeys.size).toBe(0);
    expect(result.current.selectedRows.map((row) => row.id)).toEqual(["a"]);
  });
});
