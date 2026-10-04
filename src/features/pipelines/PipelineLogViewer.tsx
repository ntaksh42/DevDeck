import { Check, Copy, Search, WrapText } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PreviewBand } from "@/components/PreviewBand";
import { isEditableTarget } from "@/lib/utils";
import { openExternalUrl } from "@/lib/openExternal";
import { type LogSeverity, logLineSeverity } from "./pipelineLogSeverity";

const LOG_SEVERITY_CLASS: Record<"error" | "warning", string> = {
  error: "bg-red-500/10 text-red-400",
  warning: "text-amber-300",
};

const FOLLOW_THRESHOLD_PX = 24;

function highlight(line: string, query: string, current: boolean): ReactNode {
  if (!query) return line || " ";
  const lower = line.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at >= 0) {
    if (at > from) parts.push(line.slice(from, at));
    parts.push(
      <mark key={at} className={current ? "bg-orange-400 text-black" : "bg-yellow-300 text-black"}>
        {line.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < line.length) parts.push(line.slice(from));
  return parts.length > 0 ? parts : line || " ";
}

const TOOL_BUTTON =
  "inline-flex h-5 items-center gap-1 rounded border border-border bg-card px-1.5 text-[11px] font-medium normal-case tracking-normal text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

// The selected node's log tail: line numbers, search (/), wrap (W), follow,
// copy, and an errors/warnings-only filter. Mount it with a `key` per log so
// per-log state (search, scroll) resets when another node is picked.
export function PipelineLogViewer({
  title,
  lines,
  truncated,
  webUrl,
}: {
  title: string;
  lines: string[];
  truncated: boolean;
  webUrl: string;
}) {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [follow, setFollow] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const classified = useMemo(
    () => lines.map((line, index) => ({ line, no: index + 1, severity: logLineSeverity(line) as LogSeverity })),
    [lines],
  );
  const issueCount = classified.filter((l) => l.severity !== null).length;
  const shown = useMemo(
    () => (errorsOnly ? classified.filter((l) => l.severity !== null) : classified),
    [classified, errorsOnly],
  );

  const matches = useMemo(() => {
    if (!query) return [] as number[];
    const needle = query.toLowerCase();
    const found: number[] = [];
    shown.forEach((entry, index) => {
      if (entry.line.toLowerCase().includes(needle)) found.push(index);
    });
    return found;
  }, [shown, query]);
  const cursor = matches.length === 0 ? -1 : Math.min(matchCursor, matches.length - 1);
  const currentLine = cursor >= 0 ? matches[cursor] : -1;

  // Follow the tail: stay pinned to the bottom while `follow` is on.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  useEffect(() => {
    if (currentLine < 0) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-line="${currentLine}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [currentLine, query]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX);
  }

  function openSearch() {
    setSearchOpen(true);
    window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 0);
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    window.setTimeout(() => scrollRef.current?.focus(), 0);
  }

  function step(delta: 1 | -1) {
    if (matches.length === 0) return;
    setFollow(false);
    setMatchCursor((cursor + delta + matches.length) % matches.length);
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
    if (event.key === "/") {
      event.preventDefault();
      event.stopPropagation();
      openSearch();
    } else if (event.key.toLowerCase() === "w") {
      event.preventDefault();
      event.stopPropagation();
      setWrap((value) => !value);
    }
  }

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; there is nothing useful to show for that.
    }
  }

  return (
    <div className="flex min-h-[18rem] flex-1 flex-col pb-2" onKeyDown={handleKeyDown}>
      <PreviewBand
        action={
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={searchOpen}
              aria-keyshortcuts="/"
              title="Search the log (/)"
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
              className={TOOL_BUTTON}
            >
              <Search className="h-3 w-3" aria-hidden="true" /> Search
            </button>
            <button
              type="button"
              aria-pressed={wrap}
              aria-keyshortcuts="W"
              title="Wrap long lines (W)"
              onClick={() => setWrap((value) => !value)}
              className={TOOL_BUTTON}
            >
              <WrapText className="h-3 w-3" aria-hidden="true" /> Wrap
            </button>
            <button
              type="button"
              aria-pressed={follow}
              title="Keep the view on the newest line"
              onClick={() => setFollow((value) => !value)}
              className={TOOL_BUTTON}
            >
              Follow
            </button>
            <button type="button" title="Copy the shown log" onClick={() => void copyLog()} className={TOOL_BUTTON}>
              {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        }
      >
        Log — {title}
      </PreviewBand>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-1 text-[11px] text-muted-foreground">
        {searchOpen ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded border border-primary bg-background px-2 text-foreground">
            <Search className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setMatchCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  step(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSearch();
                }
              }}
              placeholder="Search log"
              aria-label="Search log"
              className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            <span aria-live="polite">{query ? (matches.length === 0 ? "0" : `${cursor + 1}/${matches.length}`) : ""}</span>
          </span>
        ) : null}
        {truncated ? (
          <>
            <span>Showing last {lines.length} lines.</span>
            <button type="button" onClick={() => openExternalUrl(webUrl)} className="text-link hover:underline">
              Full log in Azure DevOps
            </button>
          </>
        ) : null}
        {issueCount > 0 ? (
          <button
            type="button"
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly((value) => !value)}
            className={`ml-auto rounded border px-1.5 py-px font-medium ${
              errorsOnly
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            Errors/warnings only ({issueCount})
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 px-3">
        <div
          ref={scrollRef}
          tabIndex={0}
          onScroll={onScroll}
          aria-label="Log output"
          className="min-h-0 flex-1 overflow-auto rounded bg-zinc-950 py-1 font-mono text-[11px] leading-relaxed text-zinc-100 outline-none focus:ring-2 focus:ring-ring"
        >
          {shown.length === 0 ? (
            <div className="px-2">{errorsOnly ? "(no error or warning lines)" : "(empty log)"}</div>
          ) : (
            shown.map(({ line, no, severity }, index) => (
              <div
                key={index}
                data-line={index}
                className={`flex gap-2 px-2 ${severity ? LOG_SEVERITY_CLASS[severity] : ""} ${
                  index === currentLine ? "outline outline-1 outline-orange-400" : ""
                }`}
              >
                <span className="w-8 shrink-0 select-none text-right text-zinc-600">{no}</span>
                <span className={wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}>
                  {highlight(line, query, index === currentLine)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
