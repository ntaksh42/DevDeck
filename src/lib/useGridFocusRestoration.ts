import { useCallback, useEffect, useRef } from "react";

const GRID_FOCUS_SELECTOR = '[role="grid"], [role="row"], [data-primary-grid="true"]';

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

  // True when focus currently rests on a concrete element that is not a grid
  // row — typically an editor in the preview pane that shares this container.
  // A background data update (e.g. sync replacing rows) must never yank focus
  // away from there; restoration is only meant to recover focus that fell back
  // to `<body>` when the selected row's node was detached.
  const focusMovedOffGrid = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return false;
    const container = containerRef.current;
    return !(container?.contains(active) && active.closest(GRID_FOCUS_SELECTOR));
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

  // Scrolling the grid away from the focused row (wheel or scrollbar) means the
  // user has moved on from it. Under virtualization the row then unmounts, and
  // React never reports that blur, so ownership would otherwise linger and the
  // next data update would scroll the grid back to the old selection. Keyboard
  // jumps keep the selected row (or the parked grid) in view, so they keep it.
  useEffect(() => {
    const onScroll = (event: Event) => {
      if (!hadFocusRef.current) return;
      const scroller = event.target;
      const container = containerRef.current;
      if (!(scroller instanceof HTMLElement) || !container?.contains(scroller)) return;
      if (!isGridScroller(scroller) || focusedGridElementInView(scroller)) return;
      hadFocusRef.current = false;
    };
    // Scroll events do not bubble; a capturing listener still sees them.
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [containerRef]);

  useEffect(() => {
    if (!hadFocusRef.current) return;
    clearBlurTimer();
    let cancelled = false;
    let timer = 0;
    let frame = 0;
    const attempt = (remaining: number) => {
      if (cancelled) return;
      // The user may have moved focus into the preview pane (an editor in the
      // same container) between the data update and this deferred attempt.
      // Bail rather than steal focus back to the row mid-edit.
      if (focusMovedOffGrid()) return;
      if (restoreFocusRef.current()) return;
      if (remaining <= 0) return;
      // A row scrolled out of the virtual window mounts after we nudge the
      // scroller, and on a busy machine that can take several frames; retry
      // once per frame so the attempt never runs ahead of rendering.
      frame = window.requestAnimationFrame(() => attempt(remaining - 1));
    };
    timer = window.setTimeout(() => attempt(10), 0);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [restoreSignature, clearBlurTimer, focusMovedOffGrid]);

  return { onFocusCapture, onBlurCapture, hadFocusRef };
}

/** The scroller sits around the grid (Work Items, My Reviews) or inside it (PR search, Inbox). */
function isGridScroller(scroller: HTMLElement): boolean {
  return Boolean(
    scroller.closest(GRID_FOCUS_SELECTOR) ?? scroller.querySelector('[data-primary-grid="true"]'),
  );
}

/** Whether keyboard focus is on this grid and still visible in its scroller. */
function focusedGridElementInView(scroller: HTMLElement): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest(GRID_FOCUS_SELECTOR)) return false;
  // Focus parked on a grid that wraps its own scroller stays in view.
  if (active.contains(scroller)) return true;
  if (!scroller.contains(active)) return false;
  const row = active.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  return row.bottom > view.top && row.top < view.bottom;
}
