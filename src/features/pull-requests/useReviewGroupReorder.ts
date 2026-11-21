import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { moveColumnTo, useColumnDrag } from '@/lib/columnDrag';
import { compareReviewGroups, reviewGroupKeyOf } from './myReviewsGrouping';
import type { MyReviewsGridViewState, ReviewGroupBy, ReviewRow } from './myReviewsTypes';

type GroupOrder = MyReviewsGridViewState['groupOrder'];

export function useReviewGroupReorder({
  allPrs, groupBy, setGroupOrder, reviewRows, scrollerEl, scrollRowIntoView,
}: {
  allPrs: readonly ReviewPullRequestSummary[];
  groupBy: ReviewGroupBy;
  setGroupOrder: Dispatch<SetStateAction<GroupOrder>>;
  reviewRows: readonly ReviewRow[];
  scrollerEl: HTMLDivElement | null;
  scrollRowIntoView: (index: number) => void;
}) {
  const pendingFocus = useRef<string | null>(null);
  const groups = useMemo(
    () => reviewRows.filter((row) => row.kind === 'header').map((row) => row.key),
    [reviewRows],
  );

  function reorder(from: string, to: string) {
    if (!groups.includes(from) || !groups.includes(to)) return;
    const knownGroups = [...allPrs]
      .sort((a, b) => compareReviewGroups(a, b, groupBy))
      .map((pr) => reviewGroupKeyOf(pr, groupBy));
    setGroupOrder((current) => {
      // Keep positions for groups missing from the current filter or sync.
      const order = [...new Set([...current[groupBy], ...knownGroups, ...groups])];
      return { ...current, [groupBy]: moveColumnTo(order, from, to) };
    });
  }

  const drag = useColumnDrag(reorder);

  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    const index = reviewRows.findIndex((row) => row.kind === 'header' && row.key === key);
    if (index < 0) {
      pendingFocus.current = null;
      return;
    }
    scrollRowIntoView(index);
    const handle = scrollerEl?.querySelector<HTMLButtonElement>(
      `[data-review-group-handle="${CSS.escape(key)}"]`,
    );
    if (handle) {
      pendingFocus.current = null;
      handle.focus({ preventScroll: true });
    }
  });

  const groupReorderProps = (key: string) => ({
    groupKey: key,
    drag: drag(key),
    onMove: (direction: -1 | 1) => {
      const target = groups[groups.indexOf(key) + direction];
      if (target === undefined) return;
      pendingFocus.current = key;
      reorder(key, target);
    },
  });
  const hasGroupReorderFocus = () => pendingFocus.current !== null
    || Boolean(scrollerEl?.contains(document.activeElement)
      && document.activeElement?.hasAttribute('data-review-group-handle'));
  return { groupReorderProps, hasGroupReorderFocus };
}
