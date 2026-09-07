import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Download, Plus, Upload } from "lucide-react";
import type { AnalyzeGroup } from "./analyzeGroupsStorage";

export type AnalyzeGroupListProps = {
  groups: AnalyzeGroup[];
  selectedId: string | null;
  onSelect: (groupId: string) => void;
  /** Moves focus into the detail pane, mirroring Enter on a grid row. */
  onOpen: () => void;
  onAdd: () => void;
  onEdit: (groupId: string) => void;
  onDelete: (groupId: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
};

export function AnalyzeGroupList({
  groups,
  selectedId,
  onSelect,
  onOpen,
  onAdd,
  onEdit,
  onDelete,
  onExport,
  onImport,
}: AnalyzeGroupListProps) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const selectedIndex = groups.findIndex((group) => group.id === selectedId);

  useEffect(() => {
    // Drop refs for groups that no longer exist so the map cannot grow forever.
    const ids = new Set(groups.map((group) => group.id));
    for (const id of [...rowRefs.current.keys()]) {
      if (!ids.has(id)) rowRefs.current.delete(id);
    }
  }, [groups]);

  function focusAt(index: number) {
    const group = groups[index];
    if (!group) return;
    onSelect(group.id);
    rowRefs.current.get(group.id)?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
      case "j":
      case "J":
        focusAt(Math.min(index + 1, groups.length - 1));
        break;
      case "ArrowUp":
      case "k":
      case "K":
        focusAt(Math.max(index - 1, 0));
        break;
      case "Home":
        focusAt(0);
        break;
      case "End":
        focusAt(groups.length - 1);
        break;
      case "Enter":
        onOpen();
        break;
      case "n":
      case "N":
        onAdd();
        break;
      case "e":
      case "E":
        if (groups[index]) onEdit(groups[index].id);
        break;
      case "Delete":
        if (groups[index]) onDelete(groups[index].id);
        break;
      default:
        handled = false;
    }
    if (handled) {
      // Keep navigation inside the list so the detail pane does not also react.
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return (
    <div className="flex min-h-0 flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Groups</span>
        <span className="tabular-nums">{groups.length}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            グループがまだありません。クエリやブランチをまとめて登録してください。
          </p>
        ) : (
          groups.map((group, index) => {
            const selected = group.id === selectedId;
            return (
              <button
                key={group.id}
                ref={(element) => {
                  rowRefs.current.set(group.id, element);
                }}
                type="button"
                aria-current={selected ? "true" : undefined}
                tabIndex={selected || (selectedIndex === -1 && index === 0) ? 0 : -1}
                onClick={() => onSelect(group.id)}
                onDoubleClick={onOpen}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "border-primary bg-secondary font-semibold"
                    : "border-transparent hover:bg-muted/70"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {group.queries.length}Q / {group.branches.length}B
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-1 p-2">
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          グループを追加
        </button>

        {/* E1 — the export/import the storage layer already supported. */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onExport}
            disabled={groups.length === 0}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            書き出し
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Upload className="h-3 w-3" aria-hidden="true" />
            読み込み
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              // Reset so re-picking the same file fires change again.
              event.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
