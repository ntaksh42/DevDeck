// Keyboard navigation for the file tree's roving-tabindex container (the tree
// itself is the only tab stop; rows carry `tabIndex={-1}` and are focused
// programmatically). Extracted from CodeBrowseView so the row-finding logic is
// unit-testable without a full component render.
//
// Arrow keys move/expand/collapse, Home/End jump to the first/last row,
// PageUp/PageDown jump by a fixed page size, and typing a letter (type-ahead)
// jumps to the next row whose name starts with the accumulated text.

export type MinimalKeyboardEvent = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
};

export type TypeAheadState = { text: string; time: number };

const PAGE_SIZE = 10;
const TYPE_AHEAD_RESET_MS = 600;

export function handleTreeKeyDown(
  event: MinimalKeyboardEvent,
  container: HTMLElement | null,
  typeAhead: { current: TypeAheadState },
  onToggleFolder: (path: string) => void,
): void {
  if (!container) return;
  const rows = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-tree-item]"));
  if (rows.length === 0) return;
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);

  if (event.key === "ArrowDown") {
    event.preventDefault();
    rows[index < 0 ? 0 : Math.min(index + 1, rows.length - 1)]?.focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    rows[index <= 0 ? 0 : index - 1]?.focus();
  } else if (event.key === "Home") {
    event.preventDefault();
    rows[0]?.focus();
  } else if (event.key === "End") {
    event.preventDefault();
    rows[rows.length - 1]?.focus();
  } else if (event.key === "PageDown") {
    event.preventDefault();
    rows[Math.min((index < 0 ? 0 : index) + PAGE_SIZE, rows.length - 1)]?.focus();
  } else if (event.key === "PageUp") {
    event.preventDefault();
    rows[Math.max((index < 0 ? 0 : index) - PAGE_SIZE, 0)]?.focus();
  } else if (event.key === "ArrowRight" && index >= 0) {
    const row = rows[index];
    if (row.dataset.folder === "true") {
      event.preventDefault();
      if (row.dataset.open === "true") rows[Math.min(index + 1, rows.length - 1)]?.focus();
      else if (row.dataset.path) onToggleFolder(row.dataset.path);
    }
  } else if (event.key === "ArrowLeft" && index >= 0) {
    const row = rows[index];
    event.preventDefault();
    if (row.dataset.folder === "true" && row.dataset.open === "true" && row.dataset.path) {
      onToggleFolder(row.dataset.path);
    } else if (row.dataset.path) {
      const parent = row.dataset.path.replace(/\/[^/]+$/, "");
      rows.find((candidate) => candidate.dataset.path === parent)?.focus();
    }
  } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    typeAheadJump(event, rows, index, typeAhead);
  }
}

// Accumulates recently typed characters (reset after a short pause) and moves
// focus to the next row, wrapping, whose name starts with the buffer.
function typeAheadJump(
  event: MinimalKeyboardEvent,
  rows: HTMLButtonElement[],
  index: number,
  typeAhead: { current: TypeAheadState },
): void {
  const now = Date.now();
  const fresh = now - typeAhead.current.time > TYPE_AHEAD_RESET_MS;
  const buffer = (fresh ? "" : typeAhead.current.text) + event.key;
  typeAhead.current = { text: buffer, time: now };
  const needle = buffer.toLowerCase();
  // A fresh search starts after the current row so repeated distinct letters
  // step through matches; a continued search rechecks the current row first
  // in case it still matches the more specific buffer.
  const start = index < 0 ? 0 : fresh ? index + 1 : index;
  for (let offset = 0; offset < rows.length; offset++) {
    const candidate = rows[(start + offset) % rows.length];
    const name = (candidate.dataset.name ?? "").toLowerCase();
    if (name.startsWith(needle)) {
      event.preventDefault();
      candidate.focus();
      return;
    }
  }
}
