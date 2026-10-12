import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActiveFilters } from "./ActiveFilters";

afterEach(cleanup);

function Harness() {
  const [count, setCount] = useState(1);
  return (
    <>
      <div role="grid" data-primary-grid="true" tabIndex={-1} />
      <ActiveFilters count={count} onClear={() => setCount(0)} />
    </>
  );
}

describe("ActiveFilters", () => {
  it("moves focus to the grid when Clear filters unmounts itself", async () => {
    render(<Harness />);

    const clear = screen.getByRole("button", { name: "Clear filters" });
    clear.focus();
    fireEvent.click(clear);

    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("grid")));
  });
});
