import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  commandErrorMessage,
  searchCommandPalette,
  type CommandPaletteSearchResults,
} from "@/lib/azdoCommands";

export type CommandPaletteAction = {
  disabled?: boolean;
  group: string;
  id: string;
  keywords?: string[];
  label: string;
  run: () => void;
  shortcut?: string;
};

export type CommandPaletteSearchSelection =
  | {
      type: "workItem";
      organizationId: string;
      projectId: string;
      id: number;
      title: string;
    }
  | {
      type: "pullRequest";
      organizationId: string;
      projectId: string;
      repositoryId: string;
      pullRequestId: number;
      title: string;
    }
  | {
      type: "commit";
      organizationId: string;
      projectId: string;
      repositoryId: string;
      commitId: string;
      title: string;
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

type PaletteEntry =
  | { kind: "action"; action: CommandPaletteAction }
  | {
      kind: "search";
      group: string;
      id: string;
      label: string;
      meta: string;
      selection: CommandPaletteSearchSelection;
    };

function scoreText(query: string, values: Array<string | number | null | undefined>): number {
  const normalizedQuery = query.trim().replace(/^#/, "").toLowerCase();
  if (!normalizedQuery) return 100;
  let best = 100;
  for (const value of values) {
    const text = String(value ?? "").toLowerCase();
    if (!text) continue;
    if (text === normalizedQuery) best = Math.min(best, 0);
    else if (text.startsWith(normalizedQuery)) best = Math.min(best, 10);
    else if (text.includes(normalizedQuery)) best = Math.min(best, 20);
  }
  return best;
}

function rankCommandPaletteResults(
  query: string,
  results: CommandPaletteSearchResults | null,
): PaletteEntry[] {
  if (!results) return [];
  const workItems = results.workItems
    .map((item, index) => ({
      entry: {
        kind: "search" as const,
        group: "Work Items",
        id: `search.wi.${item.organizationId}.${item.projectId}.${item.id}`,
        label: `#${item.id} ${item.title}`,
        meta: [item.workItemType, item.state, item.projectName].filter(Boolean).join(" · "),
        selection: {
          type: "workItem" as const,
          organizationId: item.organizationId,
          projectId: item.projectId,
          id: item.id,
          title: item.title,
        },
      },
      index,
      score: scoreText(query, [item.id, item.title]),
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 5)
    .map(({ entry }) => entry);

  const pullRequests = results.pullRequests
    .map((pr, index) => ({
      entry: {
        kind: "search" as const,
        group: "Pull Requests",
        id: `search.pr.${pr.organizationId}.${pr.repositoryId}.${pr.pullRequestId}`,
        label: `PR #${pr.pullRequestId} ${pr.title}`,
        meta: `${pr.projectName} / ${pr.repositoryName}`,
        selection: {
          type: "pullRequest" as const,
          organizationId: pr.organizationId,
          projectId: pr.projectId,
          repositoryId: pr.repositoryId,
          pullRequestId: pr.pullRequestId,
          title: pr.title,
        },
      },
      index,
      score: scoreText(query, [pr.pullRequestId, pr.title, pr.repositoryName]),
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 5)
    .map(({ entry }) => entry);

  const commits = results.commits
    .map((commit, index) => ({
      entry: {
        kind: "search" as const,
        group: "Commits",
        id: `search.commit.${commit.repositoryId}.${commit.commitId}`,
        label: `${commit.shortCommitId} ${commit.comment.split(/\r?\n/, 1)[0] || "(no comment)"}`,
        meta: [commit.projectName, commit.repositoryName, commit.authorName].filter(Boolean).join(" · "),
        selection: {
          type: "commit" as const,
          organizationId: commit.organizationId,
          projectId: commit.projectId,
          repositoryId: commit.repositoryId,
          commitId: commit.commitId,
          title: commit.comment,
        },
      },
      index,
      score: scoreText(query, [commit.commitId, commit.shortCommitId, commit.comment, commit.repositoryName]),
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 5)
    .map(({ entry }) => entry);

  return [...workItems, ...pullRequests, ...commits];
}

export function CommandPalette({
  actions,
  organizationId,
  onClose,
  onSearchResultSelect,
}: {
  actions: CommandPaletteAction[];
  organizationId?: string;
  onClose: () => void;
  onSearchResultSelect?: (selection: CommandPaletteSearchSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [usage, setUsage] = useState<Record<string, number>>(() => loadCommandUsage());
  const [searchResults, setSearchResults] = useState<CommandPaletteSearchResults | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredActionEntries = useMemo<PaletteEntry[]>(() => {
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
      .sort((left, right) => (usage[right.id] ?? 0) - (usage[left.id] ?? 0))
      .map((action) => ({ kind: "action", action }));
  }, [actions, query, usage]);

  const searchEntries = useMemo(
    () => rankCommandPaletteResults(query, searchResults),
    [query, searchResults],
  );
  const entries = useMemo(
    () => (searchEntries.length > 0 ? [...searchEntries, ...filteredActionEntries] : filteredActionEntries),
    [filteredActionEntries, searchEntries],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!onSearchResultSelect || trimmed.length < 2) {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      searchCommandPalette({ organizationId, query: trimmed })
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch((error) => {
          if (!cancelled) {
            setSearchResults(null);
            setSearchError(commandErrorMessage(error));
          }
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchResultSelect, organizationId, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function runActiveAction(index = activeIndex) {
    const entry = entries[index];
    if (!entry) return;
    onClose();
    if (entry.kind === "action") {
      recordCommandUsage(entry.action.id);
      setUsage(loadCommandUsage());
      window.setTimeout(entry.action.run, 0);
    } else {
      window.setTimeout(() => onSearchResultSelect?.(entry.selection), 0);
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
                  Math.min(index + 1, Math.max(entries.length - 1, 0)),
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
          {entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {searchLoading ? "Searching..." : searchError ?? "No commands found."}
            </div>
          ) : (
            entries.map((entry, index) => {
              const previous = entries[index - 1];
              const group = entry.kind === "action" ? entry.action.group : entry.group;
              const showGroup =
                !previous || (previous.kind === "action" ? previous.action.group : previous.group) !== group;
              return (
                <div key={entry.kind === "action" ? entry.action.id : entry.id}>
                  {showGroup ? (
                    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                      {group}
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
                    <span className="min-w-0 truncate">
                      <span className="block truncate">
                        {entry.kind === "action" ? entry.action.label : entry.label}
                      </span>
                      {entry.kind === "search" && entry.meta ? (
                        <span className="block truncate text-xs text-muted-foreground">{entry.meta}</span>
                      ) : null}
                    </span>
                    {entry.kind === "action" && entry.action.shortcut ? (
                      <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {entry.action.shortcut}
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
