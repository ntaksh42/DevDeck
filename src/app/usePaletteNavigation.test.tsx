import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePaletteNavigation } from "./usePaletteNavigation";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

it("focuses a lazily mounted grid after input autofocus, including repeat navigation", async () => {
  const setView = vi.fn();
  const { result, rerender } = renderHook(({ view }) => usePaletteNavigation(setView, view), {
    initialProps: { view: "myReviews" as "myReviews" | "workItems" },
  });
  act(() => result.current("workItems"));
  expect(setView).toHaveBeenCalledWith("workItems");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  const input = document.createElement("input");
  const grid = document.createElement("div");
  grid.dataset.primaryGrid = "true";
  grid.tabIndex = -1;
  const row = document.createElement("div");
  row.setAttribute("role", "row");
  row.setAttribute("aria-selected", "true");
  row.tabIndex = 0;
  grid.append(row);
  document.body.append(input, grid);
  input.focus();
  await waitFor(() => expect(document.activeElement).toBe(row));
  rerender({ view: "workItems" });
  input.focus();
  act(() => result.current("workItems"));
  await waitFor(() => expect(document.activeElement).toBe(row));
});

it("focuses the empty list surface", async () => {
  const { result } = renderHook(() => usePaletteNavigation(vi.fn(), "pullRequestSearch"));
  const grid = document.createElement("div");
  grid.dataset.gridFocusFallback = "true";
  grid.tabIndex = -1;
  document.body.append(grid);
  act(() => result.current("pullRequestSearch"));
  await waitFor(() => expect(document.activeElement).toBe(grid));
});

it("does not steal focus if the user interacts while a view is loading", async () => {
  const { result } = renderHook(() => usePaletteNavigation(vi.fn()));
  act(() => result.current("myReviews"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  const input = document.createElement("input");
  const grid = document.createElement("div");
  grid.dataset.primaryGrid = "true";
  grid.tabIndex = -1;
  document.body.append(input, grid);
  input.focus();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(document.activeElement).toBe(input);
});

it("skips the previous view's list while the destination is still loading", async () => {
  const { result } = renderHook(() => usePaletteNavigation(vi.fn(), "myReviews"));
  const previous = document.createElement("div");
  previous.dataset.primaryGrid = "true";
  previous.tabIndex = -1;
  document.body.append(previous);
  act(() => result.current("notifications"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(document.activeElement).not.toBe(previous);
  previous.remove();
  const next = document.createElement("div");
  next.dataset.primaryGrid = "true";
  next.tabIndex = -1;
  document.body.append(next);
  await waitFor(() => expect(document.activeElement).toBe(next));
});
