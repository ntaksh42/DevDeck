import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp, storedNumber } from "@/lib/utils";

const DEFAULT_PREVIEW_RATIO = 0.4;
const MIN_GRID_WIDTH = 480;
const SPLIT_LAYOUT_CHROME_WIDTH = 32;

export function useAdaptivePreviewWidth({
  defaultWidth,
  maxPreviewWidth,
  minPreviewWidth,
  storageKey,
}: {
  defaultWidth: number;
  maxPreviewWidth: number;
  minPreviewWidth: number;
  storageKey: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [fallbackWidth, setFallbackWidth] = useState(defaultWidth);
  const [storedRatio, setStoredRatio] = useState(() => ({
    key: storageKey,
    value: storedNumber(storageKey, DEFAULT_PREVIEW_RATIO, 0, 1),
  }));
  const ratio = storedRatio.value;

  useEffect(() => {
    setStoredRatio((current) => current.key === storageKey
      ? current
      : {
          key: storageKey,
          value: storedNumber(storageKey, DEFAULT_PREVIEW_RATIO, 0, 1),
        });
  }, [storageKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = (width = container.clientWidth) => {
      if (width > 0) setContainerWidth(width);
    };

    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      updateWidth(entry?.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (storedRatio.key !== storageKey) return;
    window.localStorage.setItem(storageKey, String(ratio));
  }, [ratio, storageKey, storedRatio.key]);

  const availableWidth = Math.max(0, containerWidth - SPLIT_LAYOUT_CHROME_WIDTH);
  const max = availableWidth > 0
    ? Math.max(minPreviewWidth, Math.min(maxPreviewWidth, availableWidth - MIN_GRID_WIDTH))
    : maxPreviewWidth;
  const width = availableWidth > 0
    ? clamp(availableWidth * ratio, minPreviewWidth, max)
    : fallbackWidth;

  const setWidth = useCallback((nextWidth: number) => {
    if (availableWidth <= 0) {
      setFallbackWidth(clamp(nextWidth, minPreviewWidth, maxPreviewWidth));
      return;
    }
    setStoredRatio({
      key: storageKey,
      value: clamp(nextWidth, minPreviewWidth, max) / availableWidth,
    });
  }, [availableWidth, max, maxPreviewWidth, minPreviewWidth, storageKey]);

  const resetWidth = useCallback(() => {
    setStoredRatio({ key: storageKey, value: DEFAULT_PREVIEW_RATIO });
    setFallbackWidth(defaultWidth);
  }, [defaultWidth, storageKey]);

  return useMemo(() => ({
    containerRef,
    max,
    resetWidth,
    setWidth,
    width,
  }), [max, resetWidth, setWidth, width]);
}
