import { Loader2, Search, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readStoredJson, writeStoredJson } from "@/lib/storage";

export type CommandPaletteAction = {
  disabled?: boolean;
  group: string;
  id: string;
  keywords?: string[];
  label: string;
  run: () => void;
  shortcut?: string;
};

export type CommandPaletteSearchItem = {
  detail?: string;
  group: string;
  id: string;
  label: string;
  run: () => void;
  runAlt?: () => void;
};

export type CommandPaletteSearch = {
  items: CommandPaletteSearchItem[];
  onQueryChange: (query: string) => void;
  pending: boolean;
};

type PaletteRow = {
  detail?: string;
  group: string;
  id: string;
  label: string;
  onRun: () => void;
  onRunAlt?: () => void;
  shortcut?: string;
};

const COMMAND_USAGE_STORAGE_KEY = "azdodeck:commandPalette:usage";

function loadCommandUsage(): Record<string, number> {
  return readStoredJson(
    COMMAND_USAGE_STORAGE_KEY,
    (raw) => (raw && typeof raw === "object" ? (raw as Record<string, number>) : undefined),
    {},
  );
}

function recordCommandUsage(id: string) {
  const usage = loadCommandUsage();
  usage[id] = Date.now();
  writeStoredJson(COMMAND_USAGE_STORAGE_KEY, usage);
}

export function CommandPalette({
  actions,
  onClose,
  search,
}: {
  actions: CommandPaletteAction[];
  onClose: () => void;
  search?: CommandPaletteSearch;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [usage, setUsage] = useState<Record<string, number>>(() => loadCommandUsage());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filteredActions = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return actions
      .filter((action) => {
        if (action.disabled) return false;
        if (terms.length === 0) return true;
        const haystack = [
          action.group,
          action.label,
          action.shortcut,
          ...(action.keywords ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) => (usage[right.id] ?? 0) - (usage[left.id] ?? 0));
  }, [actions, query, usage]);

  const rows = useMemo<PaletteRow[]>(() => {
    const actionRows: PaletteRow[] = filteredActions.map((action) => ({
      group: action.group,
      id: `action:${action.id}`,
      label: action.label,
      shortcut: action.shortcut,
      onRun: () => {
        recordCommandUsage(action.id);
        setUsage(loadCommandUsage());
        onClose();
        window.setTimeout(action.run, 0);
      },
    }));
    const searchRows: PaletteRow[] = (search?.items ?? []).map((item) => {
      const runAlt = item.runAlt;
      return {
        detail: item.detail,
        group: item.group,
        id: `search:${item.id}`,
        label: item.label,
        onRun: () => {
          onClose();
          window.setTimeout(item.run, 0);
        },
        onRunAlt: runAlt
          ? () => {
              onClose();
              window.setTimeout(runAlt, 0);
            }
          : undefined,
      };
    });
    return [...actionRows, ...searchRows];
  }, [filteredActions, onClose, search?.items]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, rows.length]);

  function runActiveRow(index = activeIndex, alt = false) {
    const row = rows[index];
    if (!row) return;
    if (alt) {
      row.onRunAlt?.();
      return;
    }
    row.onRun();
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runActiveRow(activeIndex, event.ctrlKey || event.metaKey);
    }
  }

  return (
    <div
      aria-hidden="false"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-3 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              search?.onQueryChange(event.target.value);
            }}
            placeholder={search ? "Type a command or search…" : "Type a command..."}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {search?.pending ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
          <button
            type="button"
            aria-label="Close command palette"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[50vh] overflow-auto p-1">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {search?.pending ? "Searching…" : "No commands found."}
            </div>
          ) : (
            rows.map((row, index) => {
              const previous = rows[index - 1];
              const showGroup = !previous || previous.group !== row.group;
              return (
                <div key={row.id}>
                  {showGroup ? (
                    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      {row.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => runActiveRow(index)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm ${
                      index === activeIndex ? "bg-secondary text-foreground" : "hover:bg-muted"
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      {row.label}
                      {row.detail ? (
                        <span className="ml-2 text-xs text-muted-foreground">{row.detail}</span>
                      ) : null}
                    </span>
                    {row.shortcut ? (
                      <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {row.shortcut}
                      </kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        {search ? (
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            Search work items, PRs, and commits — filter with{" "}
            <kbd className="rounded bg-muted px-1 font-mono">wi:</kbd>{" "}
            <kbd className="rounded bg-muted px-1 font-mono">pr:</kbd>{" "}
            <kbd className="rounded bg-muted px-1 font-mono">c:</kbd> · open in browser with{" "}
            <kbd className="rounded bg-muted px-1 font-mono">Ctrl+Enter</kbd>
          </div>
        ) : null}
      </div>
    </div>
  );
}
