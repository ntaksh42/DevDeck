import { ChevronDown, ChevronRight } from 'lucide-react';

interface ReviewSectionHeaderProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

export function ReviewSectionHeader({ label, count, collapsed, onToggle }: ReviewSectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex h-[29px] w-full items-center gap-1 border-b border-border bg-muted/60 px-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
    >
      {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      <span className="font-normal">· {count}</span>
    </button>
  );
}
