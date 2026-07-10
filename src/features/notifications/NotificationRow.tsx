import { forwardRef } from "react";
import { ExternalLink } from "lucide-react";
import type { NotificationRecord } from "@/lib/azdoCommands";
import { formatDate, formatRelativeDate } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { notificationKindLabel } from "./notificationKinds";
import { notificationWebUrl } from "./notificationJump";

export const NOTIFICATION_ROW_HEIGHT = 52;

export const NotificationRow = forwardRef<
  HTMLDivElement,
  {
    record: NotificationRecord;
    selected: boolean;
    organizationLabel?: string | null;
    onSelect: () => void;
  }
>(({ record, selected, organizationLabel, onSelect }, ref) => {
  const webUrl = notificationWebUrl(record);
  const detail = record.body?.split("\n")[0]?.trim() || "";

  return (
    <div
      ref={ref}
      tabIndex={selected ? 0 : -1}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex h-[52px] cursor-pointer select-none items-start gap-2 border-b border-border px-3 py-1.5 text-left outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${
        selected ? "bg-secondary" : "hover:bg-muted/50"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
          record.isRead ? "bg-transparent" : "bg-primary"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`min-w-0 truncate text-sm ${record.isRead ? "font-normal text-foreground" : "font-semibold text-foreground"}`}
            title={record.title}
          >
            {record.title}
          </span>
          <span
            className="ml-auto shrink-0 text-[11px] text-muted-foreground"
            title={formatDate(record.createdAt)}
          >
            {formatRelativeDate(record.createdAt)}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {notificationKindLabel(record.kind)}
          {organizationLabel ? ` · ${organizationLabel}` : ""}
          {detail ? ` · ${detail}` : ""}
        </div>
      </div>
      {webUrl ? (
        <button
          type="button"
          aria-label="Open in Azure DevOps"
          title="Open in Azure DevOps"
          onClick={(event) => {
            event.stopPropagation();
            void openExternalUrl(webUrl);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});
NotificationRow.displayName = "NotificationRow";
