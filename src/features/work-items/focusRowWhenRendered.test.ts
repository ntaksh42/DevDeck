import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusRowWhenRendered } from "./useWiGridLogic";

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRow() {
  const row = document.createElement("div");
  row.tabIndex = -1;
  document.body.appendChild(row);
  return row;
}

describe("focusRowWhenRendered", () => {
  it("focuses a row that is already mounted", () => {
    const row = makeRow();

    focusRowWhenRendered(() => row);
    vi.advanceTimersByTime(16);

    expect(document.activeElement).toBe(row);
  });

  // Regression: End/PageDown scroll outside the virtual window, so the
  // destination row only mounts on a later frame. A single deferred focus
  // found nothing and silently left focus on <body>.
  it("waits for a row that mounts a few frames later", () => {
    let row: HTMLElement | null = null;

    focusRowWhenRendered(() => row);
    vi.advanceTimersByTime(16);
    expect(document.activeElement).toBe(document.body);

    row = makeRow();
    vi.advanceTimersByTime(16);

    expect(document.activeElement).toBe(row);
  });

  it("gives up instead of retrying forever when the row never mounts", () => {
    const getRow = vi.fn(() => null);

    focusRowWhenRendered(getRow);
    vi.advanceTimersByTime(16 * 20);

    // The initial attempt plus the bounded retries, and nothing after that.
    expect(getRow).toHaveBeenCalledTimes(6);
  });
});
