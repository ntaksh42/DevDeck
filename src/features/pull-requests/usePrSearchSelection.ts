import { useLayoutEffect, useRef, useState } from "react";
import type { PullRequestSummary } from "@/lib/azdoCommands";
import { prSearchKey } from "./prSearchState";
import { PR_SEARCH_ROW_HEIGHT } from "./PrSearchTypes";

export function usePrSearchSelection(rows: PullRequestSummary[], resetKey: number | undefined, scroller: HTMLElement | null) {
  const [key, setKey] = useState<string | null>(null);
  const previous = useRef({ rows, resetKey });
  const focused = scroller?.contains(document.activeElement) ?? false;
  const foundIndex = key ? rows.findIndex((row) => prSearchKey(row) === key) : -1;
  const selectedIndex = foundIndex < 0 ? 0 : foundIndex;
  useLayoutEffect(() => {
    const prior = previous.current;
    previous.current = { rows, resetKey };
    if (prior.resetKey !== resetKey || foundIndex < 0) { setKey(rows[0] ? prSearchKey(rows[0]) : null); return; }
    if (prior.rows === rows || !scroller) return;
    const oldIndex = prior.rows.findIndex((row) => prSearchKey(row) === key);
    if (oldIndex >= 0) scroller.scrollTop = Math.max(0, scroller.scrollTop + (selectedIndex - oldIndex) * PR_SEARCH_ROW_HEIGHT);
    if (!focused) return;
    const frame = requestAnimationFrame(() => {
      scroller.querySelector<HTMLElement>('[role="row"][aria-selected="true"]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows, resetKey, foundIndex, key, selectedIndex, scroller, focused]);
  function setSelectedIndex(value: number | ((index: number) => number)) {
    const next = typeof value === "function" ? value(selectedIndex) : value;
    setKey(rows[next] ? prSearchKey(rows[next]) : null);
  }
  return { selectedIndex, setSelectedIndex };
}
