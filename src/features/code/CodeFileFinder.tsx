import { File as FileIcon, Loader2, Search } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { commandErrorMessage, listRepoFiles } from "@/lib/azdoCommands";
import { fuzzyFindFiles } from "./fuzzyMatch";
import type { RepoOption } from "./codeBrowseShared";

const RESULT_LIMIT = 50;

// Fuzzy file finder for the Code view: `t` opens it (GitHub / VS Code Ctrl+P
// convention), typing narrows the repository's full file list, and Enter
// jumps straight to the file in CodeFileView. Mirrors CommandPalette's
// keyboard model (arrow keys move, Enter activates, Escape closes and returns
// focus) as its own lightweight component, since reusing CommandPalette's
// actions/search API and usage-tracking footer would not fit a plain path list.
export function CodeFileFinder({
  organizationId,
  repo,
  branch,
  onSelect,
  onClose,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filesQuery = useQuery({
    queryKey: ["repoFiles", organizationId, repo.repositoryId, branch],
    queryFn: () =>
      listRepoFiles({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
      }),
    staleTime: 5 * 60_000,
  });

  const matches = useMemo(
    () => fuzzyFindFiles(query, filesQuery.data?.paths ?? [], RESULT_LIMIT),
    [query, filesQuery.data],
  );

  // Open focused on the input, and return focus to whatever owned it before
  // (the originating tree row) when this unmounts, however it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  // Keep arrow/Enter/Escape scoped to the picker so the file tree underneath
  // does not also react to them.
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const match = matches[activeIndex];
      if (match) onSelect(match.path);
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
        aria-label="Find file"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find file by name…"
            aria-label="Find file by name"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {filesQuery.isLoading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>
        <div className="max-h-[50vh] overflow-auto p-1">
          {filesQuery.isError ? (
            <p className="px-3 py-8 text-center text-sm text-destructive">
              {commandErrorMessage(filesQuery.error)}
            </p>
          ) : matches.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {filesQuery.isLoading ? "Loading files…" : "No matching files."}
            </div>
          ) : (
            matches.map((match, index) => (
              <button
                key={match.path}
                type="button"
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                aria-current={index === activeIndex ? "true" : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => onSelect(match.path)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm outline-none transition-colors ${
                  index === activeIndex
                    ? "bg-primary/10 text-foreground ring-2 ring-inset ring-primary/70"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{match.path}</span>
              </button>
            ))
          )}
        </div>
        {filesQuery.data?.truncated ? (
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            This repository has more files than the finder can list; results may be incomplete.
          </div>
        ) : null}
      </div>
    </div>
  );
}
