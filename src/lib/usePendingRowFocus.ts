import { useEffect, type RefObject } from "react";

/**
 * Moves focus onto the selected row once it is mounted, after a keyboard move
 * set `pendingRef.current = true`.
 *
 * Rows outside the virtual window unmount, and rows rendered through the dock
 * panel can mount a frame after the owner's effects run, so this retries for a
 * few frames instead of giving up while focus sits on the grid or `<body>`.
 * Runs after every render because the row may mount on any of them.
 */
export function usePendingRowFocus(
  pendingRef: RefObject<boolean>,
  rowRefs: RefObject<(HTMLElement | null)[]>,
  selectedIndex: number,
): void {
  useEffect(() => {
    if (!pendingRef.current) return;
    let frame = 0;
    let attempts = 0;
    const attempt = () => {
      if (!pendingRef.current) return;
      const row = rowRefs.current[selectedIndex];
      if (row?.isConnected) {
        pendingRef.current = false;
        row.focus({ preventScroll: true });
        return;
      }
      if (++attempts < 10) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  });
}
