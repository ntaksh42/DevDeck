import { useEffect, type RefObject } from "react";
import { useGridFocusRestoration } from "@/lib/useGridFocusRestoration";
import { useLatestRef } from "@/lib/useLatestRef";
import type { InboxEntry } from "./inboxPresentation";

export function useInboxListFocus({
  listRef, rowRefs, index, entries, scrollRowIntoView,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  rowRefs: RefObject<(HTMLDivElement | null)[]>;
  index: number;
  entries: InboxEntry[];
  scrollRowIntoView: (index: number) => void;
}) {
  const currentIndex = useLatestRef(index);
  function focusRow(target: number): boolean {
    scrollRowIntoView(target);
    const row = rowRefs.current[target];
    if (!row?.isConnected) return false;
    row.focus({ preventScroll: true });
    return true;
  }
  function focusList() {
    window.setTimeout(() => {
      if (!focusRow(currentIndex.current)) listRef.current?.focus();
    }, 0);
  }
  const restoration = useGridFocusRestoration({
    containerRef: listRef,
    restoreSignature: entries.map((entry) => entry.id).join(","),
    restoreFocus: () => focusRow(currentIndex.current),
  });
  // A selected row outside the virtual window mounts after scrolling. Only
  // transfer focus if it still rests on the list's fallback focus target.
  useEffect(() => {
    if (listRef.current && document.activeElement === listRef.current) focusRow(index);
  });
  return { ...restoration, focusRow, focusList };
}
