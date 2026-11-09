import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortHeaderButton } from "@/components/SortHeaderButton";
import { moveColumnTo, useColumnDrag } from "./columnDrag";

afterEach(() => cleanup());

describe("moveColumnTo", () => {
  it("moves a column forward into the target's slot", () => {
    expect(moveColumnTo(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a column backward into the target's slot", () => {
    expect(moveColumnTo(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the order alone for the same or unknown columns", () => {
    expect(moveColumnTo(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moveColumnTo(["a", "b"], "a", "x" as "a")).toEqual(["a", "b"]);
  });
});

function Harness({ onReorder }: { onReorder: (from: string, to: string) => void }) {
  const dragProps = useColumnDrag(onReorder);
  const sort = { key: "none", direction: "asc" as const };
  return (
    <div>
      {["a", "b"].map((key) => (
        <SortHeaderButton
          key={key}
          column={key}
          label={key.toUpperCase()}
          sort={sort}
          onSort={() => {}}
          dragProps={dragProps(key)}
        />
      ))}
    </div>
  );
}

function dataTransfer() {
  return { setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" };
}

describe("useColumnDrag", () => {
  it("reorders when a header is dragged onto another header", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const [headerA, headerB] = screen.getAllByRole("columnheader");
    const dt = dataTransfer();

    fireEvent.dragStart(screen.getByRole("button", { name: "Sort by A" }), { dataTransfer: dt });
    fireEvent.dragOver(headerB, { dataTransfer: dt });
    expect(headerB.getAttribute("data-drop-target")).toBe("true");
    fireEvent.drop(headerB, { dataTransfer: dt });

    expect(onReorder).toHaveBeenCalledWith("a", "b");
    expect(headerA.getAttribute("data-drop-target")).toBe("false");
    expect(headerB.getAttribute("data-drop-target")).toBe("false");
  });

  it("does nothing when dropped on itself or when nothing is being dragged", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const [headerA, headerB] = screen.getAllByRole("columnheader");
    const dt = dataTransfer();

    fireEvent.dragStart(screen.getByRole("button", { name: "Sort by A" }), { dataTransfer: dt });
    fireEvent.drop(headerA, { dataTransfer: dt });
    fireEvent.dragEnd(screen.getByRole("button", { name: "Sort by A" }), { dataTransfer: dt });
    fireEvent.drop(headerB, { dataTransfer: dt });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("only the sort button is draggable, so the resize handle stays free", () => {
    render(<Harness onReorder={() => {}} />);
    expect(screen.getByRole("button", { name: "Sort by A" }).getAttribute("draggable")).toBe("true");
    expect(screen.getAllByRole("columnheader")[0].hasAttribute("draggable")).toBe(false);
  });
});
