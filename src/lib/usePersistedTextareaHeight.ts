import { useLayoutEffect, useRef } from "react";

export const WORK_ITEM_COMMENT_HEIGHT_STORAGE_KEY =
  "azdodeck:commentInputHeight:workItems";
export const PULL_REQUEST_COMMENT_HEIGHT_STORAGE_KEY =
  "azdodeck:commentInputHeight:pullRequests";

const MIN_HEIGHT = 36;
const MAX_HEIGHT = 1_200;

function readHeight(storageKey: string): number | null {
  try {
    const height = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(height) && height >= MIN_HEIGHT && height <= MAX_HEIGHT
      ? height
      : null;
  } catch {
    return null;
  }
}

function writeHeight(storageKey: string, height: number): void {
  try {
    window.localStorage.setItem(storageKey, String(height));
  } catch {
    // Resizing remains usable when storage is unavailable or full.
  }
}

export function usePersistedTextareaHeight(storageKey: string) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const savedHeight = readHeight(storageKey);
    if (savedHeight !== null) textarea.style.height = `${savedHeight}px`;

    if (typeof ResizeObserver === "undefined") return;
    let previousHeight = Math.round(textarea.getBoundingClientRect().height);
    const observer = new ResizeObserver(() => {
      const height = Math.round(textarea.getBoundingClientRect().height);
      if (
        height === previousHeight ||
        height < MIN_HEIGHT ||
        height > MAX_HEIGHT
      ) {
        return;
      }
      previousHeight = height;
      writeHeight(storageKey, height);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [storageKey]);

  return textareaRef;
}
