import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 4;
const VIEWPORT_MARGIN = 8;

// Each rendered layer -> the element it is anchored to, so outside-click
// handlers can treat the detached layer as part of its owner.
const overlayAnchors = new WeakMap<Element, Element>();

/**
 * True when `target` sits inside a FloatingOverlay anchored within
 * `container`. The layer lives on `document.body`, so a plain
 * `container.contains(target)` misses it.
 */
export function isInFloatingOverlayOf(container: Element | null, target: Node): boolean {
  if (!container) return false;
  const element = target instanceof Element ? target : target.parentElement;
  const layer = element?.closest("[data-floating-overlay]");
  const anchor = layer ? overlayAnchors.get(layer) : undefined;
  return anchor ? container.contains(anchor) : false;
}

type Placement = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

/**
 * Renders `children` in a fixed-position layer on `document.body`, anchored to
 * the nearest parent element of where it is mounted. Comment inputs sit inside
 * scrolling/overflow-hidden preview panes, so an absolutely positioned list
 * (e.g. the @mention picker) gets clipped by the pane edge; this escapes the
 * clip and flips above/below to whichever side of the anchor has room.
 */
export function FloatingOverlay({
  children,
  preferred = "above",
  maxHeight = 192,
  inset = 0,
  width,
  className = "",
}: {
  children: ReactNode;
  preferred?: "above" | "below";
  maxHeight?: number;
  /** Horizontal offset from the anchor's left edge. */
  inset?: number;
  /** Fixed width in px; defaults to the anchor's width minus `inset`. */
  width?: number;
  className?: string;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const anchor = markerRef.current?.parentElement;
    if (!anchor) return;

    function update() {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN;
      const spaceBelow = viewportHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
      const wanted = maxHeight;
      const above =
        preferred === "above"
          ? spaceAbove >= wanted || spaceAbove >= spaceBelow
          : !(spaceBelow >= wanted || spaceBelow >= spaceAbove);
      const listWidth = Math.max(0, width ?? rect.width - inset);
      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.left + inset, viewportWidth - listWidth - VIEWPORT_MARGIN),
      );
      setPlacement({
        left,
        width: listWidth,
        maxHeight: Math.max(64, Math.min(wanted, above ? spaceAbove : spaceBelow)),
        ...(above
          ? { bottom: viewportHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }),
      });
    }

    update();
    // Capture scrolls from any ancestor pane, not just the window.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(anchor);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [preferred, maxHeight, inset, width]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const anchor = markerRef.current?.parentElement;
    if (layer && anchor) overlayAnchors.set(layer, anchor);
  });

  return (
    <>
      <span ref={markerRef} hidden />
      {placement
        ? createPortal(
            <div
              ref={layerRef}
              data-floating-overlay="true"
              className={`fixed z-50 overflow-auto ${className}`}
              style={{
                left: placement.left,
                width: placement.width,
                maxHeight: placement.maxHeight,
                top: placement.top,
                bottom: placement.bottom,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
