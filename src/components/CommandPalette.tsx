import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type CommandPaletteAction = {
  disabled?: boolean;
  group: string;
  id: string;
  keywords?: string[];
  label: string;
  run: () => void;
  shortcut?: string;
};

const COMMAND_USAGE_STORAGE_KEY = "azdodeck:commandPalette:usage";

function loadCommandUsage(): Record<string, number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMAND_USAGE_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function recordCommandUsage(id: string) {
  const usage = loadCommandUsage();
  usage[id] = Date.now();
  window.localStorage.setItem(COMMAND_USAGE_STORAGE_KEY, JSON.stringify(usage));
}

export function CommandPalette({
  actions,
  onClose,
}: {
  actions: CommandPaletteAction[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [usage, setUsage] = useState<Record<string, number>>(() => loadCommandUsage());
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runActiveAction(index = activeIndex) {
    const action = filteredActions[index];
    if (!action) return;
    recordCommandUsage(action.id);
    setUsage(loadCommandUsage());
    onClose();
    window.setTimeout(action.run, 0);
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
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) =>
                  Math.min(index + 1, Math.max(filteredActions.length - 1, 0)),
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runActiveAction();
              }
            }}
            placeholder="Type a command..."
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
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
          {filteredActions.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No commands found.
            </div>
          ) : (
            filteredActions.map((action, index) => {
              const previous = filteredActions[index - 1];
              const showGroup = !previous || previous.group !== action.group;
              return (
                <div key={action.id}>
                  {showGroup ? (
                    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      {action.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runActiveAction(index)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm ${
                      index === activeIndex ? "bg-secondary text-foreground" : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{action.label}</span>
                    {action.shortcut ? (
                      <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {action.shortcut}
                      </kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
