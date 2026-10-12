import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !(element instanceof HTMLInputElement && element.type === "hidden"),
  );
}

/**
 * Keeps Tab / Shift+Tab cycling inside a modal container so focus never reaches
 * the page behind the overlay. Listens on the document (capture) so it also
 * recovers when focus has fallen to <body>. With `restoreFocus`, focus returns
 * to the element that was focused when the modal mounted, once it unmounts.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { restoreFocus = false }: { restoreFocus?: boolean } = {},
) {
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const restoreTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // StrictMode re-runs effects: a restore queued by the simulated unmount
    // must not fire while the modal is still open.
    window.clearTimeout(restoreTimerRef.current);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (restoreFocus) {
        restoreTimerRef.current = window.setTimeout(() => openerRef.current?.focus(), 0);
      }
    };
  }, [containerRef, restoreFocus]);
}
