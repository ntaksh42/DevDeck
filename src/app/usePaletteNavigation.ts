import { useCallback, useEffect, useState } from "react";
import { focusPrimaryGrid } from "@/lib/utils";
import type { View } from "./types";

/** Wait for lazy views and dock contents before overriding mount autofocus. */
const FOCUS_TARGETS =
  "[data-primary-grid='true'], [data-grid-focus-fallback='true'], [data-focus-pane='grid'], [data-focus-pane='board']";

export function usePaletteNavigation(setView: (view: View) => void, currentView?: View) {
  // `stale` holds the previous view's lists, which stay mounted while a lazy
  // destination loads and must not take the focus meant for the new one.
  const [request, setRequest] = useState<{ stale: Set<Element> } | null>(null);
  useEffect(() => {
    if (!request) return;
    const fresh = (element: HTMLElement | null) => (element && !request.stale.has(element) ? element : null);
    let timer: number;
    const observer = new MutationObserver(schedule);
    function stop() {
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("keydown", stop);
      window.removeEventListener("pointerdown", stop);
    }
    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const grid = fresh(document.querySelector<HTMLElement>("[data-primary-grid='true']"));
        if (grid) {
          focusPrimaryGrid(grid);
          if (grid.contains(document.activeElement)) stop();
        } else {
          const fallback = fresh(document.querySelector<HTMLElement>("[data-grid-focus-fallback='true']"))
            ?? fresh(document.querySelector<HTMLElement>("[data-focus-pane='grid'], [data-focus-pane='board']"));
          // Keep watching: a list that is still loading replaces its
          // placeholder with the grid, which should then take focus.
          if (fallback && !fallback.contains(document.activeElement)) fallback.focus();
        }
      }, 0);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("keydown", stop);
    window.addEventListener("pointerdown", stop);
    schedule();
    return stop;
  }, [request]);
  return useCallback((view: View) => {
    const stale = view === currentView ? [] : Array.from(document.querySelectorAll(FOCUS_TARGETS));
    setView(view);
    setRequest({ stale: new Set(stale) });
  }, [setView, currentView]);
}
