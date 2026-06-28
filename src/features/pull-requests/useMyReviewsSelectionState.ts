import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { listPullRequestChanges, prLocator, type ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { recordRecentPullRequest } from '@/lib/recentItems';
import { useGridFocusRestoration } from '@/lib/useGridFocusRestoration';
import { detectFileOverlaps } from '@/lib/prOverlap';
import { acknowledgeReturn } from './reviewReturnTracking';
import { reviewTriageKey } from './myReviewsHelpers';
import { PR_GRID_ROW_HEIGHT, type MyReviewsSelectRequest } from './myReviewsTypes';

type SelectionStateInput = {
  sortedPrs: ReviewPullRequestSummary[];
  visibleSortedIndexes: number[];
  prFlatIndexes: number[];
  scrollerEl: HTMLElement | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  rowRefs: React.RefObject<(HTMLDivElement | null)[]>;
  returnedKeys: Set<string>;
  setReturnedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  resultKeysSignature: string;
  organizationId: string;
  selectRequest: MyReviewsSelectRequest | null | undefined;
  onSelectRequestHandled: (() => void) | undefined;
  onClearForSelectRequest: () => void;
};

export function useMyReviewsSelectionState({
  sortedPrs,
  visibleSortedIndexes,
  prFlatIndexes,
  scrollerEl,
  containerRef,
  rowRefs,
  returnedKeys,
  setReturnedKeys,
  resultKeysSignature,
  selectRequest,
  onSelectRequestHandled,
  onClearForSelectRequest,
}: SelectionStateInput) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [overlapPopupOpen, setOverlapPopupOpen] = useState(false);
  const overlapButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingSelectRef = useRef<MyReviewsSelectRequest | null>(null);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  function focusRow(index: number) {
    rowRefs.current[index]?.focus();
  }

  function scrollPrIntoView(prIndex: number) {
    const scroller = scrollerEl;
    if (!scroller) return;
    const flatIndex = prFlatIndexes[prIndex];
    if (flatIndex == null) return;
    const rowTop = flatIndex * PR_GRID_ROW_HEIGHT;
    const rowBottom = rowTop + PR_GRID_ROW_HEIGHT;
    if (rowTop < scroller.scrollTop) {
      scroller.scrollTop = rowTop;
    } else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = rowBottom - scroller.clientHeight;
    }
  }

  function selectVisiblePosition(position: number) {
    if (visibleSortedIndexes.length === 0) return;
    const clamped = Math.max(0, Math.min(position, visibleSortedIndexes.length - 1));
    const prIndex = visibleSortedIndexes[clamped];
    setSelectedIndex(prIndex);
    scrollPrIntoView(prIndex);
    window.setTimeout(() => focusRow(prIndex), 0);
  }

  function moveSelectionBy(delta: number) {
    const position = visibleSortedIndexes.indexOf(selectedIndex);
    selectVisiblePosition((position < 0 ? 0 : position) + delta);
  }

  function extendSelectionToIndex(targetIndex: number, explicitAnchorKey?: string) {
    const anchorKey =
      explicitAnchorKey ??
      selectionAnchor ??
      reviewTriageKey(sortedPrs[selectedIndex] ?? sortedPrs[targetIndex]);
    const anchorPosition = visibleSortedIndexes.findIndex(
      (index) => reviewTriageKey(sortedPrs[index]) === anchorKey,
    );
    const targetPosition = visibleSortedIndexes.indexOf(targetIndex);
    if (anchorPosition < 0 || targetPosition < 0) return;
    const [from, to] =
      anchorPosition <= targetPosition
        ? [anchorPosition, targetPosition]
        : [targetPosition, anchorPosition];
    const keys = new Set<string>();
    for (let position = from; position <= to; position += 1) {
      const pr = sortedPrs[visibleSortedIndexes[position]];
      if (pr) keys.add(reviewTriageKey(pr));
    }
    setSelectionAnchor(anchorKey);
    setSelectedKeys(keys);
  }

  function clearMultiSelection() {
    if (selectedKeys.size > 0) setSelectedKeys(new Set());
    setSelectionAnchor(null);
    setOverlapPopupOpen(false);
  }

  // ── Effects ────────────────────────────────────────────────────────────────
  // Keep selection on a visible row when data shrinks or a section collapses.
  useEffect(() => {
    if (visibleSortedIndexes.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (!visibleSortedIndexes.includes(selectedIndex)) {
      const next =
        visibleSortedIndexes.find((index) => index >= selectedIndex) ??
        visibleSortedIndexes[visibleSortedIndexes.length - 1];
      setSelectedIndex(next);
    }
  }, [visibleSortedIndexes, selectedIndex]);

  // Cross-link: switch org/filters/sections to reveal the target PR, then
  // remember it as pending so the resolution effect below can select it.
  useEffect(() => {
    if (!selectRequest) return;
    pendingSelectRef.current = selectRequest;
    onClearForSelectRequest();
    onSelectRequestHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectRequest?.requestId]);

  // Land a pending cross-link selection once its target PR appears in rows.
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (!pending) return;
    const targetIndex = sortedPrs.findIndex(
      (pr) =>
        pr.pullRequestId === pending.pullRequestId &&
        (!pending.repositoryId || pr.repositoryId === pending.repositoryId),
    );
    if (targetIndex < 0) return;
    pendingSelectRef.current = null;
    setSelectedIndex(targetIndex);
    window.setTimeout(() => {
      scrollPrIntoView(targetIndex);
      focusRow(targetIndex);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedPrs]);

  const selectedPr = sortedPrs[selectedIndex] ?? null;

  // Record recent PR; acknowledge "returned" highlight on open.
  useEffect(() => {
    if (!selectedPr) return;
    recordRecentPullRequest(selectedPr);
    const key = reviewTriageKey(selectedPr);
    if (returnedKeys.has(key)) {
      acknowledgeReturn(key);
      setReturnedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPr]);

  // Focus restoration after background sync replaces DOM nodes.
  const { onFocusCapture: handleGridFocusCapture, onBlurCapture: handleGridBlurCapture } =
    useGridFocusRestoration({
      containerRef,
      restoreSignature: `${resultKeysSignature}#${selectedIndex}`,
      restoreFocus: () => {
        scrollPrIntoView(selectedIndex);
        const node = rowRefs.current[selectedIndex];
        if (!node) return false;
        node.focus();
        return true;
      },
    });

  // ── Multi-selection / overlap ──────────────────────────────────────────────
  const selectedPrs = useMemo(() => {
    if (selectedKeys.size === 0) return selectedPr ? [selectedPr] : [];
    return sortedPrs.filter((pr) => selectedKeys.has(reviewTriageKey(pr)));
  }, [selectedKeys, sortedPrs, selectedPr]);

  const isMultiSelect = selectedPrs.length >= 2;

  const changeQueries = useQueries({
    queries: selectedPrs.map((pr) => ({
      queryKey: [
        'pullRequestChanges',
        pr.organizationId,
        pr.repositoryId,
        pr.pullRequestId,
      ],
      queryFn: () => listPullRequestChanges(prLocator(pr)),
      staleTime: 5 * 60_000,
    })),
  });

  const changesLoading = changeQueries.some((q) => q.isLoading);

  const overlap = useMemo(() => {
    if (!isMultiSelect) return { overlaps: [], fileCount: 0 };
    const prFileSets = selectedPrs.map((pr, i) => ({
      key: reviewTriageKey(pr),
      files: (changeQueries[i]?.data?.files ?? []).map((file) => file.path),
    }));
    return detectFileOverlaps(prFileSets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiSelect, selectedPrs, changeQueries.map((q) => q.dataUpdatedAt).join('|')]);

  const singleFileCount =
    !isMultiSelect && changeQueries[0]?.data ? changeQueries[0].data.files.length : null;

  const prKeyToLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const pr of selectedPrs) {
      map.set(reviewTriageKey(pr), `#${pr.pullRequestId}`);
    }
    return map;
  }, [selectedPrs]);

  return {
    selectedIndex,
    setSelectedIndex,
    selectedKeys,
    selectionAnchor,
    overlapPopupOpen,
    setOverlapPopupOpen,
    overlapButtonRef,
    selectedPr,
    selectedPrs,
    isMultiSelect,
    changesLoading,
    overlap,
    singleFileCount,
    prKeyToLabel,
    handleGridFocusCapture,
    handleGridBlurCapture,
    focusRow,
    scrollPrIntoView,
    selectVisiblePosition,
    moveSelectionBy,
    extendSelectionToIndex,
    clearMultiSelection,
  };
}
