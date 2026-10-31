import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGridColumns } from "@/lib/useGridColumns";

afterEach(() => localStorage.clear());

describe("useGridColumns", () => {
  it("keeps shownColumns stable across re-renders so memoized rows skip them", () => {
    const visibleColumns = ["id", "title", "state"] as const;
    const { result, rerender } = renderHook(() =>
      useGridColumns({
        keys: ["id", "title", "state"],
        visibleColumns: [...visibleColumns],
        flexibleKey: "title",
        defaults: [60, 300, 90],
        min: [40, 120, 60],
        max: [120, 900, 200],
        storageKey: "test:grid-columns",
      }),
    );
    const first = result.current.shownColumns;
    rerender();
    rerender();
    expect(result.current.shownColumns).toBe(first);
    expect(first).toEqual(["id", "title", "state"]);
  });
});
