import { forwardRef } from "react";
import { Check, ExternalLink, MessageSquare } from "lucide-react";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { gridRowStateClass } from "@/lib/gridRowState";
import { VERDICTS } from "./InboxInsightPanel";
import {
  formatSnoozeUntil,
  inboxKindLabel,
  inboxKindClass,
  inboxLocationLabel,
  inboxRowTitle,
  inboxSubjectLabel,
  type InboxEntry,
  type InboxTab,
} from "./inboxPresentation";

export const INBOX_ROW_HEIGHT = 30;

/** One compact line: kind, `!id repo`, summary, and age (or wake time). */
export const InboxRow = forwardRef<
  HTMLDivElement,
  {
    item: InboxEntry;
    tab: InboxTab;
    selected: boolean;
    /** Marked with X / Shift+↑↓ for a bulk Done / Snooze. */
    checked?: boolean;
    domId: string;
    onSelect: () => void;
    onOpen: () => void;
  }
>(({ item, tab, selected, checked = false, domId, onSelect, onOpen }, ref) => {
  const timeLabel =
    tab === "snoozed"
      ? formatSnoozeUntil(item.snoozedUntil)
      : tab === "done" && item.doneAt
        ? formatRelativeDate(item.doneAt)
        : formatRelativeDate(item.detectedAt);
  const timeTitle = formatDate(
    tab === "snoozed" && item.snoozedUntil
      ? item.snoozedUntil
      : tab === "done" && item.doneAt
        ? item.doneAt
        : item.detectedAt,
  );

  const rowTitle = inboxRowTitle(item);
  const location = inboxLocationLabel(item);
  const verdict = item.insight?.status === "ready" && item.insight.verdict ? VERDICTS[item.insight.verdict] : undefined;

  return (
    <div
      ref={ref}
      id={domId}
      role="option"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={{ height: INBOX_ROW_HEIGHT }}
      className={`group flex cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${gridRowStateClass({ selected, inMultiSelection: checked })}`}
    >
      {checked ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Marked" /> : null}
      <span className={`w-16 shrink-0 text-xs font-semibold ${inboxKindClass(item.kind)}`}>
        {inboxKindLabel(item.kind)}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
        <span className="shrink-0 whitespace-nowrap font-medium" title={item.title}>
          {inboxSubjectLabel(item)}
        </span>
        {location ? (
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground" title={item.filePath ?? undefined}>
            {location}
          </span>
        ) : null}
        <span className="min-w-0 shrink truncate text-foreground/90" title={item.snippet ?? undefined}>
          {item.author ? `${item.author}: ` : ""}
          {item.snippet ?? item.title}
        </span>
        {/* The comment is what the row is for; the title only says which PR /
            work item it is about, so it takes the leftover width and gives it
            all up before the comment starts to truncate. */}
        {rowTitle ? (
          <span
            className="min-w-0 shrink-[100] truncate whitespace-nowrap text-muted-foreground"
            title={rowTitle}
          >
            {`· ${rowTitle}`}
          </span>
        ) : null}
      </span>
      {verdict ? (
        <span
          className={`shrink-0 rounded border px-1 text-[11px] font-semibold leading-4 ${verdict.rowClassName}`}
          title="Verdict by Claude"
        >
          {verdict.label}
        </span>
      ) : null}
      {item.hitCount > 1 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
          title={`${item.hitCount} comments waiting in this conversation`}
        >
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          {item.hitCount}
        </span>
      ) : null}
      {item.webUrl ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Open in Azure DevOps"
          title="Open in Azure DevOps (O / Ctrl+Enter)"
          onClick={(event) => {
            event.stopPropagation();
            void openExternalUrl(item.webUrl as string);
          }}
          className={`shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground ${
            selected ? "visible" : "invisible group-hover:visible"
          }`}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
      <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground" title={timeTitle}>
        {timeLabel}
      </span>
    </div>
  );
});
InboxRow.displayName = "InboxRow";
