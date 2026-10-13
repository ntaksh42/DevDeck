import { forwardRef } from "react";
import { ExternalLink } from "lucide-react";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { gridRowStateClass } from "@/lib/gridRowState";
import {
  formatSnoozeUntil,
  inboxEntryKindLabel,
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
    domId: string;
    onSelect: () => void;
    onOpen: () => void;
  }
>(({ item, tab, selected, domId, onSelect, onOpen }, ref) => {
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
      className={`group flex cursor-pointer select-none items-center gap-2 border-b border-border px-2 text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${gridRowStateClass({ selected })}`}
    >
      <span className={`w-16 shrink-0 text-xs font-semibold ${inboxKindClass(item.kind)}`}>
        {inboxEntryKindLabel(item)}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 whitespace-nowrap font-medium" title={item.title}>
          {inboxSubjectLabel(item)}
        </span>
        {location ? (
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-muted-foreground" title={item.filePath ?? undefined}>
            {location}
          </span>
        ) : null}
        <span className="min-w-0 shrink truncate text-muted-foreground" title={item.snippet ?? undefined}>
          {item.author ? `${item.author}: ` : ""}
          {item.snippet ?? item.title}
        </span>
        {/* The comment is what the row is for; the title only says which PR /
            work item it is about, so it takes the leftover width and gives it
            all up before the comment starts to truncate. */}
        {rowTitle ? (
          <span
            className="min-w-0 shrink-[100] truncate whitespace-nowrap text-muted-foreground/70"
            title={rowTitle}
          >
            {`· ${rowTitle}`}
          </span>
        ) : null}
      </span>
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
