import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

describe("ResizeHandle", () => {
  it("does not start a parent pointer gesture while resizing", () => {
    const onParentPointerDown = vi.fn();

    render(
      <div onPointerDown={onParentPointerDown}>
        <ResizeHandle
          ariaLabel="Resize preview"
          direction={-1}
          min={280}
          max={800}
          onChange={() => {}}
          onReset={() => {}}
          value={420}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize preview" }), {
      clientX: 500,
      pointerId: 1,
    });

    expect(onParentPointerDown).not.toHaveBeenCalled();
  });

  // Mirrors how DockableWorkspace drives the handle: `onChange` asks dockview
  // for a width, but dockview only grants what the surrounding layout allows
  // (a sibling panel's own minWidth stops the drag well before this handle's
  // `max`), and echoes the granted width back as the `value` prop.
  function ClampedHarness({ layoutMax }: { layoutMax: number }) {
    const [width, setWidth] = useState(400);
    return (
      <>
        <span data-testid="width">{width}</span>
        <ResizeHandle
          ariaLabel="Resize preview"
          direction={-1}
          min={300}
          max={8192}
          value={width}
          onChange={(next) => {
            const applied = Math.min(next, layoutMax);
            setWidth(applied);
            return applied;
          }}
          onReset={() => setWidth(440)}
        />
      </>
    );
  }

  it("resumes immediately after the layout clamped the requested width", () => {
    // This file's suite has no global RTL cleanup, so scope queries to this
    // render's own container instead of the whole document.
    const view = render(<ClampedHarness layoutMax={500} />);
    const handle = within(view.container).getByRole("separator", { name: "Resize preview" });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });

    // direction -1: dragging left grows the panel. Ask for far more than the
    // layout can give, so the granted width is clamped to 500.
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 1 });
    expect(within(view.container).getByTestId("width").textContent).toBe("500");

    // Dragging back right by 50px must shrink from the width actually on
    // screen (500 -> 450). Accumulating from the pointerdown anchor instead
    // would leave a dead zone the size of the overshoot.
    fireEvent.pointerMove(window, { clientX: 250, pointerId: 1 });
    expect(within(view.container).getByTestId("width").textContent).toBe("450");
  });

  it("tracks the pointer normally when nothing clamps the width", () => {
    const view = render(<ClampedHarness layoutMax={8192} />);
    const handle = within(view.container).getByRole("separator", { name: "Resize preview" });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 480, pointerId: 1 });
    expect(within(view.container).getByTestId("width").textContent).toBe("420");

    fireEvent.pointerMove(window, { clientX: 440, pointerId: 1 });
    expect(within(view.container).getByTestId("width").textContent).toBe("460");

    fireEvent.pointerMove(window, { clientX: 520, pointerId: 1 });
    expect(within(view.container).getByTestId("width").textContent).toBe("380");
  });

  // dockview echoes the granted width back through onDidDimensionsChange, which
  // lands in React state a render later. That echo is NOT synchronous with the
  // pointermove that caused it, so several moves can fire before `value`
  // catches up -- the handle must not depend on it to track the pointer.
  function LaggingEchoHarness({ layoutMax }: { layoutMax: number }) {
    const [width, setWidth] = useState(400);
    return (
      <>
        <span data-testid="width">{width}</span>
        <ResizeHandle
          ariaLabel="Resize preview"
          direction={-1}
          min={300}
          max={8192}
          value={width}
          onChange={(next) => {
            const applied = Math.min(next, layoutMax);
            setTimeout(() => setWidth(applied), 0);
            return applied;
          }}
          onReset={() => setWidth(440)}
        />
      </>
    );
  }

  it("does not drift when moves outpace the echoed width", async () => {
    const view = render(<LaggingEchoHarness layoutMax={8192} />);
    const handle = within(view.container).getByRole("separator", { name: "Resize preview" });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    // Three moves back-to-back with no echo delivered in between -- what a
    // fast drag looks like when pointermove outruns React's render.
    fireEvent.pointerMove(window, { clientX: 480, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 460, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 440, pointerId: 1 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Dragged 60px left from 400, so the panel must have grown the full 60px.
    expect(within(view.container).getByTestId("width").textContent).toBe("460");
  });

  it("re-anchors on a clamp even while the echoed width lags", async () => {
    const view = render(<LaggingEchoHarness layoutMax={500} />);
    const handle = within(view.container).getByRole("separator", { name: "Resize preview" });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 1 }); // asks 700, granted 500
    fireEvent.pointerMove(window, { clientX: 250, pointerId: 1 }); // back 50px off the wall

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(within(view.container).getByTestId("width").textContent).toBe("450");
  });

  // axis="y" is what GroupResizeOverlay uses for an above/below split (see
  // DockableWorkspace.tsx): the handle is a horizontal line and the drag
  // tracks clientY instead of clientX. It shares the same pointer-tracking
  // logic as the x axis, so this only needs to confirm the coordinate swap,
  // the re-anchor-on-clamp behavior, and the accessibility metadata -- not
  // re-cover every scenario the x-axis tests above already exercise.
  function ClampedHeightHarness({ layoutMax }: { layoutMax: number }) {
    const [height, setHeight] = useState(400);
    return (
      <>
        <span data-testid="height">{height}</span>
        <ResizeHandle
          ariaLabel="Resize preview"
          axis="y"
          direction={-1}
          min={120}
          max={8192}
          value={height}
          onChange={(next) => {
            const applied = Math.min(next, layoutMax);
            setHeight(applied);
            return applied;
          }}
          onReset={() => setHeight(440)}
        />
      </>
    );
  }

  it("reports a horizontal orientation on axis=\"y\"", () => {
    const view = render(<ClampedHeightHarness layoutMax={8192} />);
    const handle = within(view.container).getByRole("separator", { name: "Resize preview" });
    expect(handle.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("tracks clientY on axis=\"y\"", () => {
    const view = render(<ClampedHeightHarness layoutMax={8192} />);
    const handle = within(view.container).getByRole("separator", { name: "Resize preview" });

    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    // direction -1: dragging up (clientY decreases) grows the panel, same as
    // dragging left does on the x axis.
    fireEvent.pointerMove(window, { clientY: 480, pointerId: 1 });
    expect(within(view.container).getByTestId("height").textContent).toBe("420");
  });

  it("re-anchors on a clamp on axis=\"y\"", () => {
    const view = render(<ClampedHeightHarness layoutMax={500} />);
    const handle = within(view.container).getByRole("separator", { name: "Resize preview" });

    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    // Ask for far more than the layout can give (400 + 300 = 700), so the
    // granted height is clamped to 500.
    fireEvent.pointerMove(window, { clientY: 200, pointerId: 1 });
    expect(within(view.container).getByTestId("height").textContent).toBe("500");

    // Dragging back down by 50px must shrink from the height actually on
    // screen (500 -> 450), not from the pointerdown anchor.
    fireEvent.pointerMove(window, { clientY: 250, pointerId: 1 });
    expect(within(view.container).getByTestId("height").textContent).toBe("450");
  });
});
