import { forwardRef, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WorkItemSummary } from '@/lib/azdoCommands';
import { focusPrimaryPreview } from '@/lib/utils';
import {
  loadRowColorRules,
  ROW_COLOR_RULES_CHANGED_EVENT,
  type RowColorRule,
} from '@/lib/rowColorRules';
import { openExternalUrl } from '@/lib/openExternal';
import { workItemStaleDays } from './workItemStale';
import {
  workItemCellValue,
  extraFieldValue,
  type WiSortKey,
} from './workItemsGridHelpers';

// Reactively reads the row color rules and refreshes when they change in
// Settings or another tab (mirrors useKeybindings in App.tsx).
export function useRowColorRules(): RowColorRule[] {
  const [rules, setRules] = useState<RowColorRule[]>(loadRowColorRules);
  useEffect(() => {
    const refresh = () => setRules(loadRowColorRules());
    window.addEventListener(ROW_COLOR_RULES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ROW_COLOR_RULES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return rules;
}

export const WorkItemGridRow = forwardRef<
  HTMLDivElement,
  {
    item: WorkItemSummary;
    selected: boolean;
    checked: boolean;
    unread: boolean;
    columnTemplate: string;
    visibleColumns: WiSortKey[];
    extraColumns: string[];
    staleThresholdDays: number;
    rowColorClass: string | null;
    onSelect: () => void;
    onCheckedChange: (checked: boolean, shiftKey: boolean) => void;
  }
>(({ item, selected, checked, unread, columnTemplate, visibleColumns, extraColumns, staleThresholdDays, rowColorClass, onSelect, onCheckedChange }, ref) => {
  const staleDays = workItemStaleDays(item, Date.now());
  const isStale = staleDays !== null && staleDays >= staleThresholdDays;
  return (
  <div
    ref={ref}
    tabIndex={selected ? 0 : -1}
    role="row"
    aria-selected={selected}
    onClick={onSelect}
    onKeyDown={(e) => {
      if ((e.target as HTMLElement).closest("button,input")) return;
      if (e.key === "Enter") {
        e.stopPropagation();
        if (e.ctrlKey && item.webUrl) openExternalUrl(item.webUrl);
        else focusPrimaryPreview();
      } else if ((e.key === "o" || e.key === "O") && item.webUrl) {
        e.stopPropagation();
        openExternalUrl(item.webUrl);
      }
    }}
    className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
      checked
        ? "bg-primary/5"
        : selected && isStale
          ? "bg-orange-100 dark:bg-orange-900/30"
          : selected
            ? "bg-secondary"
            : rowColorClass
              ? rowColorClass
              : isStale
                ? "bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100/70"
                : "hover:bg-muted/50"
    }`}
    style={{ gridTemplateColumns: columnTemplate }}
  >
    <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={`Select #${item.id}`}
        onChange={() => {}}
        onClick={(e) => {
          e.stopPropagation();
          onCheckedChange(e.currentTarget.checked, e.shiftKey);
        }}
        className="h-3.5 w-3.5 cursor-pointer rounded border-input"
      />
    </div>
    {visibleColumns.map((column) => {
      const isTitle = column === "title";
      return (
        <div
          key={column}
          className={isTitle ? "flex min-w-0 items-center gap-1" : "min-w-0 truncate"}
          style={
            isTitle && item.depth
              ? { paddingLeft: Math.min(item.depth, 8) * 14 }
              : undefined
          }
        >
          {isTitle && unread ? (
            <span
              role="img"
              aria-label="Unread activity"
              title="Changed since you last opened it"
              className="h-2 w-2 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400"
            />
          ) : null}
          {isTitle && isStale ? (
            <AlertTriangle
              role="img"
              className="h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400"
              aria-label={`${staleDays} 日間更新なし`}
            >
              <title>{staleDays} 日間更新なし</title>
            </AlertTriangle>
          ) : null}
          {isTitle ? (
            <span className="min-w-0 flex-1 truncate">
              {workItemCellValue(item, column)}
            </span>
          ) : (
            workItemCellValue(item, column)
          )}
        </div>
      );
    })}
    {extraColumns.map((referenceName) => {
      const value = extraFieldValue(item, referenceName);
      return (
        <div key={referenceName} className="min-w-0 truncate">
          <span className="truncate text-xs text-muted-foreground" title={value ?? undefined}>
            {value ?? "—"}
          </span>
        </div>
      );
    })}
  </div>
  );
});
WorkItemGridRow.displayName = "WorkItemGridRow";
