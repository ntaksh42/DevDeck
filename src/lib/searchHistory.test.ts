import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { RECENT_SEARCHES_MAX, loadSearchHistory, useSearchHistory } from "./searchHistory";

const entry = (query: string, filters = { s: 1 }) => ({ query, filters, summary: "s" });

describe("useSearchHistory", () => {
  beforeEach(() => window.localStorage.clear());

  it("records newest first, dedupes identical searches and caps at 5", () => {
    const { result } = renderHook(() => useSearchHistory<{ s: number }>("t"));
    act(() => {
      for (const q of ["a", "b", "c", "d", "e", "f", "c"]) result.current.record(entry(q));
    });
    expect(result.current.history.recent.map((e) => e.query)).toEqual(["c", "f", "e", "d", "b"]);
    expect(result.current.history.recent).toHaveLength(RECENT_SEARCHES_MAX);
    expect(loadSearchHistory("t").recent).toHaveLength(RECENT_SEARCHES_MAX);
  });

  it("treats a different filter set as a different search", () => {
    const { result } = renderHook(() => useSearchHistory<{ s: number }>("t"));
    act(() => {
      result.current.record(entry("a", { s: 1 }));
      result.current.record(entry("a", { s: 2 }));
    });
    expect(result.current.history.recent).toHaveLength(2);
  });

  it("pins into saved and removes entries", () => {
    const { result } = renderHook(() => useSearchHistory<{ s: number }>("t"));
    act(() => result.current.record(entry("a")));
    const id = result.current.history.recent[0].id;
    act(() => result.current.pin(id));
    expect(result.current.history.saved.map((e) => e.query)).toEqual(["a"]);
    act(() => result.current.remove("recent", id));
    expect(result.current.history.recent).toEqual([]);
    expect(loadSearchHistory("t").saved).toHaveLength(1);
    act(() => result.current.remove("saved", id));
    expect(loadSearchHistory("t").saved).toEqual([]);
  });

  it("falls back to empty on corrupt storage", () => {
    window.localStorage.setItem("azdodeck:t:searchHistory", "{nope");
    expect(loadSearchHistory("t")).toEqual({ recent: [], saved: [] });
  });
});
