import { Fragment, forwardRef } from 'react';
import type { ReviewPullRequestSummary } from '@/lib/azdoCommands';
import { focusPrimaryPreview } from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { renderPrCell } from './myReviewsCells';
import type { SortKey } from './myReviewsTypes';
import { gridRowStateClass } from '@/lib/gridRowState';

type ReviewPrRowProps = {
  pr: ReviewPullRequestSummary;
  selected: boolean;
  inMultiSelection: boolean;
  returned: boolean;
  columnTemplate: string;
  visibleColumns: SortKey[];
  staleThresholdDays: number;
  onSelect: (event: { shiftKey: boolean; ctrlKey: boolean }) => void;
};

export const ReviewPrRow = forwardRef<HTMLDivElement, ReviewPrRowProps>(
  (
    {
      pr,
      selected,
      inMultiSelection,
      returned,
      columnTemplate,
      visibleColumns,
      staleThresholdDays,
      onSelect,
    },
    ref,
  ) => {
    const createdTime = new Date(pr.creationDate).getTime();
    const isStale = Number.isFinite(createdTime)
      ? Math.floor((Date.now() - createdTime) / 86_400_000) >= staleThresholdDays
      : false;
    return (
      <div
        ref={ref}
        tabIndex={selected ? 0 : -1}
        role="row"
        aria-selected={selected || inMultiSelection}
        onClick={(e) => onSelect({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey })}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) {
            return;
          }
          if (e.key === 'Enter') {
            e.stopPropagation();
            if (e.ctrlKey && pr.webUrl) openExternalUrl(pr.webUrl);
            else focusPrimaryPreview();
          }
        }}
        className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none
        focus:ring-2 focus:ring-inset focus:ring-ring
        ${gridRowStateClass({ selected, inMultiSelection, isStale })}`}
        style={{ gridTemplateColumns: columnTemplate }}
      >
        {visibleColumns.map((key) => (
          <Fragment key={key}>{renderPrCell(key, pr, isStale, returned)}</Fragment>
        ))}
      </div>
    );
  },
);
ReviewPrRow.displayName = 'ReviewPrRow';
