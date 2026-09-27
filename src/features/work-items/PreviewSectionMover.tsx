import {
  createContext,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { GripVertical } from "lucide-react";
import {
  type DropPosition,
  dropPreviewSection,
  loadPreviewSectionLayout,
  type PreviewSectionColumn,
  type PreviewSectionId,
  type PreviewSectionLayout,
  sectionColumn,
  sectionsInColumn,
  stepPreviewSection,
  storePreviewSectionLayout,
} from "./previewSectionLayout";

const DRAG_MIME = "application/x-azdodeck-preview-section";

type HeaderMoveProps = {
  draggable: true;
  title: string;
  "aria-keyshortcuts": string;
  "data-preview-section-header": PreviewSectionId;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
};

const SectionHeaderMoveContext = createContext<HeaderMoveProps | null>(null);

/** Drag/keyboard props for a section header, when it sits in a movable slot. */
export function usePreviewSectionHeaderMoveProps(): HeaderMoveProps | null {
  return useContext(SectionHeaderMoveContext);
}

/** Hover/focus hint that the header can be dragged. */
export function SectionGrip({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <GripVertical
      className="ml-auto h-3 w-3 shrink-0 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-slate-400"
      aria-hidden="true"
    />
  );
}

type DropTarget = {
  column: PreviewSectionColumn | null;
  targetId: PreviewSectionId | null;
  position: DropPosition;
};

/**
 * Owns the persisted section layout plus the drag and Alt+Arrow interactions
 * that change it. `column` is null in the single-list (comments below) layout.
 */
export function usePreviewSectionMover({
  scopeRef,
  sideBySide,
  visible,
}: {
  scopeRef: RefObject<HTMLElement | null>;
  sideBySide: boolean;
  visible: ReadonlySet<PreviewSectionId>;
}) {
  const [layout, setLayout] = useState<PreviewSectionLayout>(loadPreviewSectionLayout);
  const [dragging, setDragging] = useState<PreviewSectionId | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const focusAfterMoveRef = useRef<PreviewSectionId | null>(null);

  // A moved header is re-inserted (or remounted in the other column), which
  // drops focus; put it back so repeated Alt+Arrow presses keep working.
  useLayoutEffect(() => {
    const id = focusAfterMoveRef.current;
    if (!id) return;
    focusAfterMoveRef.current = null;
    const header = scopeRef.current?.querySelector<HTMLElement>(
      `[data-preview-section-header="${id}"]`,
    );
    header?.focus();
    header?.scrollIntoView({ block: "nearest" });
  }, [layout, scopeRef]);

  function commit(next: PreviewSectionLayout) {
    setLayout(next);
    storePreviewSectionLayout(next);
  }

  function endDrag() {
    setDragging(null);
    setDropTarget(null);
  }

  function headerProps(id: PreviewSectionId): HeaderMoveProps {
    return {
      draggable: true,
      title: sideBySide
        ? "Drag to move · Alt+↑/↓ reorder · Alt+←/→ move between columns"
        : "Drag to move · Alt+↑/↓ reorder",
      "aria-keyshortcuts": sideBySide
        ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
        : "Alt+ArrowUp Alt+ArrowDown",
      "data-preview-section-header": id,
      onDragStart: (event) => {
        event.dataTransfer.setData(DRAG_MIME, id);
        event.dataTransfer.effectAllowed = "move";
        setDragging(id);
      },
      onDragEnd: endDrag,
      onKeyDown: (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        let next: PreviewSectionLayout | null = null;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          next = stepPreviewSection(
            layout,
            id,
            event.key === "ArrowUp" ? -1 : 1,
            visible,
            sideBySide ? sectionColumn(layout, id) : null,
          );
        } else if (sideBySide && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          const column = event.key === "ArrowLeft" ? "main" : "side";
          if (sectionColumn(layout, id) !== column) {
            next = dropPreviewSection(layout, id, column, null);
          }
        } else {
          return;
        }
        // Handled (even at an edge) so Alt+←/→ doesn't fall through to the
        // app's back/forward navigation while a section header has focus.
        event.preventDefault();
        event.stopPropagation();
        if (next) {
          focusAfterMoveRef.current = id;
          commit(next);
        }
      },
    };
  }

  function sameTarget(a: DropTarget | null, b: DropTarget) {
    return (
      a !== null && a.column === b.column && a.targetId === b.targetId && a.position === b.position
    );
  }

  /** Drop handling for a whole column; its empty area appends to the end. */
  function columnDropProps(column: PreviewSectionColumn | null) {
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!dragging) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        // Gaps between slots keep the last slot target; only a different
        // column (e.g. an empty side column) switches to "append".
        if (dropTarget?.column !== column) {
          setDropTarget({ column, targetId: null, position: "after" });
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!dragging) return;
        event.preventDefault();
        const target = dropTarget ?? { column, targetId: null, position: "after" as const };
        commit(
          dropPreviewSection(
            layout,
            dragging,
            target.column ?? sectionColumn(layout, dragging),
            target.targetId,
            target.position,
          ),
        );
        endDrag();
      },
    };
  }

  /** Renders the visible sections of a column, each in a movable slot. */
  function renderColumn(
    column: PreviewSectionColumn | null,
    renderSection: (id: PreviewSectionId) => ReactNode,
  ): ReactNode[] {
    const ids = sectionsInColumn(layout, column).filter((id) => visible.has(id));
    return ids.map((id) => {
      const indicator =
        dropTarget && dropTarget.column === column && dropTarget.targetId === id
          ? dropTarget.position
          : null;
      return (
        <div
          key={id}
          className={`relative mt-2 ${column === "side" ? "first:mt-0" : ""} ${
            dragging === id ? "opacity-50" : ""
          }`}
          data-preview-section-slot={id}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            const next: DropTarget = {
              column,
              targetId: id,
              position: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
            };
            if (!sameTarget(dropTarget, next)) setDropTarget(next);
          }}
        >
          {indicator === "before" ? <DropIndicator edge="top" /> : null}
          <SectionHeaderMoveContext.Provider value={headerProps(id)}>
            {renderSection(id)}
          </SectionHeaderMoveContext.Provider>
          {indicator === "after" ? <DropIndicator edge="bottom" /> : null}
        </div>
      );
    });
  }

  const appendIndicator = (column: PreviewSectionColumn | null) =>
    dropTarget && dropTarget.column === column && dropTarget.targetId === null ? (
      <div className="pointer-events-none mt-1 h-0.5 rounded bg-primary" aria-hidden="true" />
    ) : null;

  return {
    layout,
    dragging,
    renderColumn,
    columnDropProps,
    appendIndicator,
    /** Visible sections placed in `column`. */
    visibleIn: (column: PreviewSectionColumn) =>
      sectionsInColumn(layout, column).filter((id) => visible.has(id)),
  };
}

function DropIndicator({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded bg-primary ${
        edge === "top" ? "-top-1" : "-bottom-1"
      }`}
      aria-hidden="true"
    />
  );
}
