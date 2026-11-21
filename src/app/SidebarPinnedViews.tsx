import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { NavSubItem } from "@/components/Nav";
import { useColumnDrag } from "@/lib/columnDrag";
import { reorderWorkItemViews } from "@/features/work-items/workItemViewsHelpers";
import type { WorkItemQueryView } from "@/features/work-items/workItemViewsStorage";

export function SidebarPinnedViews({ views, setViews, counts, activeId, disabled, onOpen }: {
  views: WorkItemQueryView[];
  setViews: Dispatch<SetStateAction<WorkItemQueryView[]>>;
  counts: readonly { data?: number }[];
  activeId: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const canReorder = !disabled && views.length > 1;
  function reorder(from: string, to: string) {
    setViews((current) => reorderWorkItemViews(current, from, to));
  }
  const drag = useColumnDrag(reorder);

  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-pinned-view="${CSS.escape(id)}"] button`)?.focus();
  }, [views]);

  return (
    <div ref={rootRef} className="space-y-0.5">
      {views.map((view, index) => {
        const props = drag(view.id);
        return (
          <div
            key={view.id}
            data-pinned-view={view.id}
            draggable={canReorder}
            data-drop-target={props.cell["data-drop-target"]}
            className="rounded-md data-[drop-target=true]:ring-1 data-[drop-target=true]:ring-inset data-[drop-target=true]:ring-primary"
            title={canReorder ? "Drag to reorder or press Alt + Up / Down" : undefined}
            onDragStart={(event) => {
              event.stopPropagation();
              if (canReorder) props.handle.onDragStart(event);
            }}
            onDragEnd={(event) => {
              event.stopPropagation();
              props.handle.onDragEnd();
            }}
            onDragOver={(event) => {
              props.cell.onDragOver(event);
              if (event.defaultPrevented) event.stopPropagation();
            }}
            onDrop={(event) => {
              props.cell.onDrop(event);
              if (event.defaultPrevented) event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (!canReorder || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
              event.preventDefault();
              event.stopPropagation();
              const target = views[index + (event.key === "ArrowUp" ? -1 : 1)];
              if (!target) return;
              pendingFocus.current = view.id;
              reorder(view.id, target.id);
            }}
          >
            <NavSubItem active={activeId === view.id} disabled={disabled} label={view.name}
              badge={counts[index]?.data ?? null} reorderable={canReorder} onClick={() => onOpen(view.id)} />
          </div>
        );
      })}
    </div>
  );
}
