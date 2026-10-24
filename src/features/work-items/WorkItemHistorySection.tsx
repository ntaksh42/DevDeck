import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";
import type { WorkItemPreview } from "@/lib/azdoCommands";
import { commandErrorMessage, listWorkItemUpdates } from "@/lib/azdoCommands";
import { formatRelativeDate } from "@/lib/utils";
import { workItemQueryKeys } from "./queryKeys";
import { workItemFieldLabel } from "./workItemPreviewHelpers";
import { SectionGrip, usePreviewSectionHeaderMoveProps } from "./PreviewSectionMover";

export function WorkItemHistorySection({ preview }: { preview: WorkItemPreview }) {
  const [open, setOpen] = useState(false);
  const move = usePreviewSectionHeaderMoveProps();
  const updatesQuery = useQuery({
    queryKey: workItemQueryKeys.updates(
      preview.organizationId,
      preview.projectId,
      preview.id,
    ),
    queryFn: () =>
      listWorkItemUpdates({
        organizationId: preview.organizationId,
        projectId: preview.projectId,
        workItemId: preview.id,
      }),
    enabled: open,
    staleTime: 60_000,
  });
  const updates = updatesQuery.data ?? [];

  return (
    <section className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        {...move}
        className="group flex w-full items-center gap-1 rounded border-l-4 border-l-muted-foreground bg-info/10 px-1.5 py-1 text-left hover:bg-info/20 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-info transition-transform ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        />
        <h3 className="text-2xs font-extrabold uppercase tracking-wider leading-4 text-foreground">
          History
        </h3>
        {open && updatesQuery.isFetching ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
        <SectionGrip show={move !== null} />
      </button>
      {open ? (
        updatesQuery.isError ? (
          <p className="mt-1 text-2xs text-destructive">
            {commandErrorMessage(updatesQuery.error)}
          </p>
        ) : updates.length === 0 && !updatesQuery.isFetching ? (
          <p className="mt-1 text-2xs text-muted-foreground">No field changes recorded.</p>
        ) : (
          <div className="mt-1 space-y-1.5">
            {updates.map((update) => (
              <article
                key={update.id}
                className="min-w-0 rounded border border-border bg-card px-1.5 py-1"
              >
                <div className="flex min-w-0 items-baseline gap-1.5 text-2xs">
                  <span className="min-w-0 truncate font-semibold">
                    {update.revisedBy ?? "Unknown"}
                  </span>
                  {update.revisedDate ? (
                    <span
                      className="shrink-0 text-muted-foreground"
                      title={new Date(update.revisedDate).toLocaleString()}
                    >
                      {formatRelativeDate(update.revisedDate)}
                    </span>
                  ) : null}
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {update.changes.map((change) => (
                    <li
                      key={change.referenceName}
                      className="flex min-w-0 flex-wrap items-baseline gap-1 text-2xs leading-4"
                      title={change.referenceName}
                    >
                      <span className="text-muted-foreground">
                        {workItemFieldLabel(change.referenceName)}:
                      </span>
                      {change.oldValue ? (
                        <>
                          <span className="truncate text-muted-foreground line-through">
                            {change.oldValue}
                          </span>
                          <span aria-hidden="true" className="text-muted-foreground">→</span>
                        </>
                      ) : null}
                      <span className="truncate font-medium">{change.newValue ?? "(cleared)"}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
