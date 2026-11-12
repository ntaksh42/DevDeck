import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReviewSection } from './myReviewsTypes';

interface ReviewSectionHeaderProps {
  label: string;
  count: number;
  collapsed: boolean;
  /** Muted PR-title summary; only rendered while collapsed. Display-only. */
  preview: string;
  /** Status section, used for the accent color. Omitted when grouping by repository. */
  section?: ReviewSection;
  onToggle: () => void;
}

const ACCENTS: Record<ReviewSection, { bar: string; text: string; badge: string }> = {
  needsReview: {
    bar: 'border-l-sky-500',
    text: 'text-sky-700 dark:text-sky-300',
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  },
  waitingAuthor: {
    bar: 'border-l-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  approved: {
    bar: 'border-l-green-500',
    text: 'text-green-700 dark:text-green-300',
    badge: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  },
  rejected: {
    bar: 'border-l-red-500',
    text: 'text-red-700 dark:text-red-300',
    badge: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  },
  draft: {
    bar: 'border-l-slate-400',
    text: 'text-muted-foreground',
    badge: 'bg-muted text-muted-foreground',
  },
};

const NEUTRAL_ACCENT = {
  bar: 'border-l-primary',
  text: 'text-foreground',
  badge: 'bg-muted text-muted-foreground',
};

export function ReviewSectionHeader({ label, count, collapsed, preview, section, onToggle }: ReviewSectionHeaderProps) {
  const accent = section ? ACCENTS[section] : NEUTRAL_ACCENT;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={`flex h-[29px] w-full items-center gap-1.5 border-b border-l-4 border-border bg-muted/60 px-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring ${accent.bar}`}
    >
      {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className={`shrink-0 whitespace-nowrap ${accent.text}`}>{label}</span>
      <span className={`rounded-full px-1.5 text-2xs font-medium leading-4 ${accent.badge}`}>
        <span className="sr-only">(</span>{count}<span className="sr-only">)</span>
      </span>
      {collapsed && preview ? (
        <span aria-hidden="true" className="ml-2 min-w-0 truncate whitespace-nowrap font-normal opacity-80">
          {preview}
        </span>
      ) : null}
    </button>
  );
}
