import { ChevronDown, ChevronRight } from 'lucide-react';

interface ReviewSectionHeaderProps {
  label: string;
  count: number;
  collapsed: boolean;
  /** Muted PR-title summary; only rendered while collapsed. Display-only. */
  preview: string;
  onToggle: () => void;
}

export function ReviewSectionHeader({ label, count, collapsed, preview, onToggle }: ReviewSectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex h-[29px] w-full items-center gap-1 border-b border-border bg-muted/60 px-2 text-left text-2xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
    >
      {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {label}
      <span className="font-normal normal-case">({count})</span>
      {collapsed && preview ? (
        <span aria-hidden="true" className="ml-2 min-w-0 truncate whitespace-nowrap font-normal normal-case opacity-70">
          {preview}
        </span>
      ) : null}
    </button>
  );
}
