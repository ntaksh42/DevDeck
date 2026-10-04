import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Organization } from "@/lib/azdoCommands";
import { lineHash, parseLineHash, webUrl, type LineRange, type RepoOption } from "./codeBrowseShared";

const TOAST_MS = 2000;

// Line-range selection for the file viewer. A range (1-based, inclusive) is
// picked with click / Shift+click on a line number or Shift+Arrow from a focused
// line number, mirrored in the URL hash (`#L10-L20`) and restored from it, and
// can be copied as an Azure DevOps permalink or as the raw lines.
//
// `anchor` is the end the selection started from; `focus` is the end that moves
// with Shift+click / Shift+Arrow. They are seeded once from the hash so a
// shared `#L10-L20` link restores the same range for the first file this view
// instance shows; switching files afterwards clears them.
export function useLineSelection({
  organization,
  repo,
  branch,
  path,
  lines,
}: {
  organization: Organization | undefined;
  repo: RepoOption;
  branch: string;
  path: string;
  lines: string[];
}) {
  const [anchor, setAnchor] = useState<number | null>(
    () => parseLineHash(window.location.hash)?.start ?? null,
  );
  const [focus, setFocus] = useState<number | null>(
    () => parseLineHash(window.location.hash)?.end ?? null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const isFirstPathRef = useRef(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const range: LineRange | null =
    anchor != null && focus != null
      ? { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
      : null;

  useEffect(() => {
    if (isFirstPathRef.current) {
      isFirstPathRef.current = false;
      return;
    }
    setAnchor(null);
    setFocus(null);
  }, [path]);

  const rangeStart = range?.start;
  const rangeEnd = range?.end;
  useEffect(() => {
    const hash =
      rangeStart != null && rangeEnd != null ? lineHash({ start: rangeStart, end: rangeEnd }) : "";
    if (window.location.hash !== hash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${hash}`,
      );
    }
  }, [rangeStart, rangeEnd]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), TOAST_MS);
  }

  function selectLine(lineNumber: number, extend: boolean) {
    if (extend && anchor != null) {
      setFocus(lineNumber);
    } else {
      setAnchor(lineNumber);
      setFocus(lineNumber);
    }
  }

  async function copyLink() {
    if (!range) return;
    try {
      await navigator.clipboard.writeText(webUrl(organization, repo, path, branch, range));
      showToast("Link copied");
    } catch {
      showToast("Failed to copy link");
    }
  }

  async function copyLines() {
    if (!range) return;
    try {
      await navigator.clipboard.writeText(lines.slice(range.start - 1, range.end).join("\n"));
      showToast("Lines copied");
    } catch {
      showToast("Failed to copy lines");
    }
  }

  function lineButtons(): HTMLButtonElement[] {
    return Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>("[data-line-item]") ?? [],
    );
  }

  // The code pane is the only tab stop; tabbing into it moves real focus to the
  // selected (or first) line number, like the file tree's roving container.
  function onFocus(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.target !== containerRef.current) return;
    const buttons = lineButtons();
    if (buttons.length === 0) return;
    buttons[Math.min(focus ?? 1, buttons.length) - 1]?.focus();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-line-item")) {
      return;
    }
    const buttons = lineButtons();
    if (buttons.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      const nextIndex = Math.min(
        Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0),
        buttons.length - 1,
      );
      buttons[nextIndex]?.focus();
      if (event.shiftKey) {
        setAnchor((current) => current ?? index + 1);
        setFocus(nextIndex + 1);
      } else {
        setAnchor(nextIndex + 1);
        setFocus(nextIndex + 1);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      void copyLink();
    } else if (event.key === "Escape" && range) {
      event.preventDefault();
      setAnchor(null);
      setFocus(null);
    }
  }

  return {
    range,
    selectLine,
    copyLink,
    copyLines,
    toast,
    containerRef,
    onFocus,
    onKeyDown,
  };
}
