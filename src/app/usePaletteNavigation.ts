import { useCallback, useEffect, useState } from "react";
import { focusPrimaryGrid } from "@/lib/utils";
import type { View } from "./types";

/** Wait for lazy views and dock contents before overriding mount autofocus. */
export function usePaletteNavigation(setView: (view: View) => void) {
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (!request) return;
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
        const grid = document.querySelector<HTMLElement>("[data-primary-grid='true']");
        if (grid) {
          focusPrimaryGrid();
          if (grid.contains(document.activeElement)) stop();
        } else {
          const fallback = document.querySelector<HTMLElement>("[data-grid-focus-fallback='true']")
            ?? document.querySelector<HTMLElement>("[data-focus-pane='grid'], [data-focus-pane='board']");
          if (fallback) {
            fallback.focus();
            stop();
          }
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
    setView(view);
    setRequest((value) => value + 1);
  }, [setView]);
}
