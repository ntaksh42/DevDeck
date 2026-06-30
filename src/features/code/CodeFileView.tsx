import {
  type KeyboardEvent as ReactKeyboardEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, ChevronUp, Copy, Loader2, Search, WrapText, X } from "lucide-react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { highlightCode } from "@/lib/highlight";
import { leafName, type RepoOption, useRepoFile } from "./codeBrowseShared";

type LineMatch = { start: number; end: number; ordinal: number };

// Right pane when a file is selected: its content with line numbers and
// highlight.js syntax coloring. A find-in-file bar (Ctrl+F) highlights matches
// and scrolls between them; while searching, lines render as plain text with
// the matches marked so highlight spans don't get in the way.
export function CodeFileView({
  organizationId,
  repo,
  branch,
  path,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  path: string;
}) {
  const query = useRepoFile(organizationId, repo, branch, path);

  const content = query.data?.content ?? "";
  const lines = useMemo(() => content.split("\n"), [content]);
  const highlighted = useMemo(
    () => (content ? highlightCode(content, leafName(path)) : null),
    [content, path],
  );

  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  // Defer the heavy per-line scan so typing in the find box stays responsive on
  // large files; the input itself updates immediately.
  const deferredFind = useDeferredValue(find);
  const [current, setCurrent] = useState(0);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const currentMatchRef = useRef<HTMLElement | null>(null);

  // Reset the find/view state whenever the file changes.
  useEffect(() => {
    setFindOpen(false);
    setFind("");
    setCurrent(0);
    setCopied(false);
  }, [path]);

  // Per-line match ranges plus the total count, computed once per query change.
  const { lineMatches, total } = useMemo(() => {
    const needle = deferredFind.toLowerCase();
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
  }, [deferredFind, lines]);

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

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; leave the button state unchanged.
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
  const wrapClass = wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre";
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onContainerKeyDown}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1">
        <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
          {highlighted?.language ? (
            <span className="uppercase tracking-wide">{highlighted.language}</span>
          ) : null}
          <span>{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWrap((value) => !value)}
            aria-pressed={wrap}
            title={wrap ? "Disable line wrap" : "Wrap long lines"}
            className={`flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:text-foreground ${
              wrap ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <WrapText className="h-3.5 w-3.5" aria-hidden="true" /> Wrap
          </button>
          <button
            type="button"
            onClick={copyContent}
            title="Copy file contents"
            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
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
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex font-mono text-[12px] leading-5">
          <div
            aria-hidden="true"
            className="shrink-0 select-none border-r border-border px-2 py-1 text-right text-muted-foreground"
          >
            {lines.map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
          {searching ? (
            <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-1">
              <code className={wrapClass}>
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
                className={`hljs ${wrapClass} bg-transparent`}
                // The HTML is highlight.js output, sanitized by highlightCode.
                dangerouslySetInnerHTML={{ __html: highlighted?.html ?? "" }}
              />
            </pre>
          )}
        </div>
      </div>
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
