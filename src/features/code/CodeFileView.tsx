import {
  type KeyboardEvent as ReactKeyboardEvent,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Copy, Link2, Loader2, Search, X } from "lucide-react";
import { commandErrorMessage, getRepoFile, type Organization } from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { highlightCode } from "@/lib/highlight";
import {
  leafName,
  lineHash,
  parseLineHash,
  webUrl,
  type LineRange,
  type RepoOption,
} from "./codeBrowseShared";

type LineMatch = { start: number; end: number; ordinal: number };

// Right pane when a file is selected: its content with line numbers and
// highlight.js syntax coloring. A find-in-file bar (Ctrl+F) highlights matches
// and scrolls between them; while searching, lines render as plain text with
// the matches marked so highlight spans don't get in the way. Line numbers are
// selectable (click, Shift+click, or keyboard) to highlight a range, reflect it
// in the URL hash (`#L10-L20`) for restore on reload, and copy a permalink or
// the raw line content.
export function CodeFileView({
  organization,
  organizationId,
  repo,
  branch,
  path,
}: {
  organization: Organization | undefined;
  organizationId: string;
  repo: RepoOption;
  branch: string;
  path: string;
}) {
  const query = useQuery({
    queryKey: ["repoFile", organizationId, repo.repositoryId, branch, path],
    queryFn: () =>
      getRepoFile({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
        path,
      }),
    enabled: !!branch,
    staleTime: 60_000,
  });

  const content = query.data?.content ?? "";
  const lines = useMemo(() => content.split("\n"), [content]);
  const highlighted = useMemo(
    () => (content ? highlightCode(content, leafName(path)) : null),
    [content, path],
  );

  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [current, setCurrent] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const currentMatchRef = useRef<HTMLElement | null>(null);

  // Selected line range (1-based, inclusive). `anchor` is the end the
  // selection started from; `focus` is the end that moves with Shift+click or
  // Shift+Arrow. Seeded once from the URL hash so a shared/reloaded `#L10-L20`
  // link restores the same range for the first file this view instance shows.
  const [anchor, setAnchor] = useState<number | null>(
    () => parseLineHash(window.location.hash)?.start ?? null,
  );
  const [focus, setFocus] = useState<number | null>(
    () => parseLineHash(window.location.hash)?.end ?? null,
  );
  const isFirstPathRef = useRef(true);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const range: LineRange | null =
    anchor != null && focus != null
      ? { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
      : null;

  // Reset the find and line-selection state whenever the file changes, except
  // on the very first file this instance shows (so the hash-seeded selection
  // above survives the initial mount).
  useEffect(() => {
    setFindOpen(false);
    setFind("");
    setCurrent(0);
    if (isFirstPathRef.current) {
      isFirstPathRef.current = false;
    } else {
      setAnchor(null);
      setFocus(null);
    }
  }, [path]);

  // Keep the URL hash in sync with the current selection so it can be shared
  // or restored on reload.
  useEffect(() => {
    const hash = range ? lineHash(range) : "";
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, [range?.start, range?.end]);

  // Per-line match ranges plus the total count, computed once per query change.
  const { lineMatches, total } = useMemo(() => {
    const needle = find.toLowerCase();
    const map = new Map<number, LineMatch[]>();
    let ordinal = 0;
    if (needle) {
      lines.forEach((line, index) => {
        const lower = line.toLowerCase();
        const ranges: LineMatch[] = [];
        let from = 0;
        for (;;) {
          const at = lower.indexOf(needle, from);
          if (at < 0) break;
          ranges.push({ start: at, end: at + needle.length, ordinal: ordinal++ });
          from = at + needle.length;
        }
        if (ranges.length > 0) map.set(index, ranges);
      });
    }
    return { lineMatches: map, total: ordinal };
  }, [find, lines]);

  // Keep the current index in range and scroll the active match into view.
  useEffect(() => {
    if (total === 0) {
      setCurrent(0);
      return;
    }
    setCurrent((value) => (value >= total ? 0 : value));
  }, [total]);
  useEffect(() => {
    // scrollIntoView is missing in some environments (e.g. jsdom under test).
    currentMatchRef.current?.scrollIntoView?.({ block: "center" });
  }, [current, lineMatches]);

  function openFind() {
    setFindOpen(true);
    // Focus after the input mounts.
    window.setTimeout(() => findInputRef.current?.select(), 0);
  }

  function step(delta: number) {
    if (total === 0) return;
    setCurrent((value) => (value + delta + total) % total);
  }

  function selectLine(lineNumber: number, extend: boolean) {
    if (extend && anchor != null) {
      setFocus(lineNumber);
    } else {
      setAnchor(lineNumber);
      setFocus(lineNumber);
    }
  }

  // Move actual DOM focus into the gutter when it's first tabbed into, like
  // the file tree's roving-tabindex container.
  function onGutterFocus(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.target !== gutterRef.current) return;
    const buttons = gutterRef.current?.querySelectorAll<HTMLButtonElement>("[data-line-item]");
    if (!buttons || buttons.length === 0) return;
    const target = focus ?? 1;
    (buttons[Math.min(target, buttons.length) - 1] ?? buttons[0])?.focus();
  }

  function onGutterKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const container = gutterRef.current;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-line-item]"));
    if (buttons.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const currentIndex = index < 0 ? (focus ?? 1) - 1 : index;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.min(Math.max(currentIndex + delta, 0), buttons.length - 1);
      const nextLine = nextIndex + 1;
      buttons[nextIndex]?.focus();
      if (event.shiftKey) {
        setAnchor((current) => current ?? currentIndex + 1);
        setFocus(nextLine);
      } else {
        setAnchor(nextLine);
        setFocus(nextLine);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      void copyLineLink();
    } else if (event.key === "Escape" && (anchor != null || focus != null)) {
      event.preventDefault();
      setAnchor(null);
      setFocus(null);
    }
  }

  function showCopyToast(message: string) {
    setCopyToast(message);
    window.setTimeout(() => setCopyToast(null), 2000);
  }

  async function copyLineLink() {
    if (!range) return;
    try {
      await navigator.clipboard.writeText(webUrl(organization, repo, path, branch, range));
      showCopyToast("Link copied");
    } catch {
      showCopyToast("Failed to copy link");
    }
  }

  async function copyLineContent() {
    if (!range) return;
    try {
      await navigator.clipboard.writeText(lines.slice(range.start - 1, range.end).join("\n"));
      showCopyToast("Lines copied");
    } catch {
      showCopyToast("Failed to copy lines");
    }
  }

  function onContainerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFind();
    }
  }

  function onFindKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFindOpen(false);
      setFind("");
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState message={commandErrorMessage(query.error)} />;
  }
  const file = query.data;
  if (!file) return null;
  if (file.isBinary) {
    return <div className="px-3 py-3 text-sm text-muted-foreground">Binary file not shown.</div>;
  }
  if (file.tooLarge) {
    return (
      <div className="px-3 py-3 text-sm text-muted-foreground">File is too large to preview.</div>
    );
  }

  const searching = findOpen && find.length > 0;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onContainerKeyDown}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          {range ? (
            <>
              <span className="text-muted-foreground">
                {range.start === range.end ? `Line ${range.start}` : `Lines ${range.start}-${range.end}`}
              </span>
              <button
                type="button"
                onClick={() => void copyLineLink()}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Copy link
              </button>
              <button
                type="button"
                onClick={() => void copyLineContent()}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy lines
              </button>
            </>
          ) : null}
        </div>
        {findOpen ? (
          <div className="flex items-center gap-1 text-sm">
            <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <input
              ref={findInputRef}
              type="text"
              value={find}
              onChange={(event) => {
                setFind(event.target.value);
                setCurrent(0);
              }}
              onKeyDown={onFindKeyDown}
              placeholder="Find in file"
              aria-label="Find in file"
              className="h-7 w-48 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="w-16 text-center text-xs text-muted-foreground">
              {total === 0 ? (find ? "0/0" : "") : `${current + 1}/${total}`}
            </span>
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={total === 0}
              aria-label="Previous match"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={total === 0}
              aria-label="Next match"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setFindOpen(false);
                setFind("");
              }}
              aria-label="Close find"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openFind}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" /> Find
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex font-mono text-[12px] leading-5">
          <div
            ref={gutterRef}
            role="group"
            aria-label="Line numbers"
            tabIndex={0}
            onFocus={onGutterFocus}
            onKeyDown={onGutterKeyDown}
            className="shrink-0 border-r border-border py-1 text-right text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {lines.map((_, index) => {
              const lineNumber = index + 1;
              const selected = !!range && lineNumber >= range.start && lineNumber <= range.end;
              return (
                <button
                  key={lineNumber}
                  type="button"
                  data-line-item
                  tabIndex={-1}
                  aria-label={`Line ${lineNumber}`}
                  aria-pressed={selected}
                  onClick={(event: ReactMouseEvent<HTMLButtonElement>) =>
                    selectLine(lineNumber, event.shiftKey)
                  }
                  className={`block w-full px-2 text-right tabular-nums outline-none ${
                    selected ? "bg-amber-200/40 text-foreground dark:bg-amber-400/20" : "hover:text-foreground"
                  }`}
                >
                  {lineNumber}
                </button>
              );
            })}
          </div>
          {searching ? (
            <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-1">
              <code className="whitespace-pre">
                {lines.map((line, index) => (
                  <div key={index}>
                    {renderLineWithMatches(line, lineMatches.get(index), current, currentMatchRef)}
                  </div>
                ))}
              </code>
            </pre>
          ) : (
            <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-1">
              <code
                className="hljs whitespace-pre bg-transparent"
                // The HTML is highlight.js output, sanitized by highlightCode.
                dangerouslySetInnerHTML={{ __html: highlighted?.html ?? "" }}
              />
            </pre>
          )}
        </div>
      </div>
      {copyToast ? (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1 text-xs text-background shadow-lg">
          {copyToast}
        </div>
      ) : null}
    </div>
  );
}

// Renders one line with its matches wrapped in <mark>, the active match flagged
// and given the scroll ref.
function renderLineWithMatches(
  line: string,
  matches: LineMatch[] | undefined,
  current: number,
  currentRef: { current: HTMLElement | null },
) {
  if (!matches || matches.length === 0) return line || " ";
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    if (match.start > cursor) parts.push(line.slice(cursor, match.start));
    const isCurrent = match.ordinal === current;
    parts.push(
      <mark
        key={index}
        ref={
          isCurrent
            ? (node) => {
                currentRef.current = node;
              }
            : undefined
        }
        className={isCurrent ? "bg-amber-400 text-black" : "bg-amber-200 text-black"}
      >
        {line.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  });
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}
