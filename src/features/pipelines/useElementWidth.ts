import { useLayoutEffect, useState } from "react";

/**
 * Tracks an element's width so a dense layout can add columns only when there
 * is room. Takes the element (from a callback ref held in state) so it keeps
 * working when the element mounts later.
 */
export function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next != null) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
