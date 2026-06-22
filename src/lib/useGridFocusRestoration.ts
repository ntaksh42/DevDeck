import { useCallback, useEffect, useRef } from "react";

const GRID_FOCUS_SELECTOR = '[role="grid"], [role="row"]';

/**
 * Keeps keyboard focus on the selected grid row across data updates.
 *
 * Background sync replaces or removes the focused row's DOM node, which makes
 * the browser blur it and fall back to `<body>`. Two things conspire to strand
 * focus there:
 *
 * 1. The blur from node removal reports a `null` `relatedTarget`, which looks
 *    just like the user clicking empty space. Clearing the "grid had focus"
 *    flag synchronously on that blur defeats any restoration that follows.
 * 2. Under row virtualization the selected row may be unmounted (no ref) until
 *    it is scrolled back into the window.
 *
 * This hook tracks focus ownership in a way that survives the node-removal
 * blur (deferring the decision so an in-flight restoration can win) and, when
 * the data signature changes, retries `restoreFocus` across a few frames so a
 * row that needs to scroll back into view still gets focused.
 */
export function useGridFocusRestoration({
  containerRef,
  restoreSignature,
  restoreFocus,
}: {
  /** The element wrapping the grid; used to detect whether focus is inside. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Changes whenever the rendered rows change (e.g. a result-keys signature). */
  restoreSignature: string;
  /**
   * Move focus back to the currently selected row, scrolling it into the
   * virtualized window if needed. Returns `true` once focus was applied.
   */
  restoreFocus: () => boolean;
}) {
  const hadFocusRef = useRef(false);
  const blurClearTimerRef = useRef<number | null>(null);
  // Always call the latest closure so the focus effect can key on the data
  // signature alone without going stale.
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;

  const focusInsideGrid = useCallback(() => {
    const container = containerRef.current;
    const active = document.activeElement;
    return Boolean(
      container &&
        active instanceof HTMLElement &&
        container.contains(active) &&
        active.closest(GRID_FOCUS_SELECTOR),
    );
  }, [containerRef]);

  const clearBlurTimer = useCallback(() => {
    if (blurClearTimerRef.current !== null) {
      window.clearTimeout(blurClearTimerRef.current);
      blurClearTimerRef.current = null;
    }
  }, []);

  const onFocusCapture = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      clearBlurTimer();
      const target = event.target;
      hadFocusRef.current =
        target instanceof HTMLElement && Boolean(target.closest(GRID_FOCUS_SELECTOR));
    },
    [clearBlurTimer],
  );

  const onBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof HTMLElement) {
        // Focus moved to a concrete element: drop ownership only when it left
        // the grid, keep it when focus stays on another grid/row control.
        if (!nextTarget.closest(GRID_FOCUS_SELECTOR)) {
          clearBlurTimer();
          hadFocusRef.current = false;
        }
        return;
      }
      // `relatedTarget` is null: focus fell back to `<body>`. This happens both
      // when the user clicks empty space and when a data update detaches the
      // focused row. Defer the decision so an in-flight restoration can win.
      clearBlurTimer();
      blurClearTimerRef.current = window.setTimeout(() => {
        blurClearTimerRef.current = null;
        if (!focusInsideGrid()) hadFocusRef.current = false;
      }, 0);
    },
    [clearBlurTimer, focusInsideGrid],
  );

  useEffect(() => {
    if (!hadFocusRef.current) return;
    clearBlurTimer();
    let cancelled = false;
    let timer = 0;
    const attempt = (remaining: number) => {
      if (cancelled) return;
      if (restoreFocusRef.current()) return;
      if (remaining <= 0) return;
      // A row scrolled out of the virtual window mounts on the next frame after
      // we nudge the scroller; give it a couple of retries to appear.
      timer = window.setTimeout(() => attempt(remaining - 1), 16);
    };
    timer = window.setTimeout(() => attempt(2), 0);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [restoreSignature, clearBlurTimer]);

  return { onFocusCapture, onBlurCapture, hadFocusRef };
}
