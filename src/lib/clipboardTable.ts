// Ctrl+C in the grids copies the selected rows as a table: an HTML <table>
// (pastes as a real table into Outlook / Gmail / Teams / Word) plus a TSV
// plain-text fallback (pastes into Excel or a text editor).
export type CopyColumn<T> = {
  label: string;
  text: (row: T) => string;
  // Optional hyperlink wrapped around the cell text (ID / title cells).
  href?: (row: T) => string | null | undefined;
};

const FONT = "'Segoe UI','Yu Gothic UI',Meiryo,sans-serif";
const BORDER = "1px solid #c8c8c8";
const CELL_STYLE = `border:${BORDER};padding:4px 8px;font-family:${FONT};font-size:13px;vertical-align:top;`;
const HEAD_STYLE = `${CELL_STYLE}background:#f0f0f0;font-weight:600;text-align:left;white-space:nowrap;`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function htmlCell<T>(column: CopyColumn<T>, row: T): string {
  const text = column.text(row);
  const href = column.href?.(row);
  // An empty cell would collapse in some mail clients; keep it one line tall.
  const inner = text === "" ? "&nbsp;" : escapeHtml(text);
  const content = href && text !== "" && isHttpUrl(href) ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
  return `<td style="${CELL_STYLE}">${content}</td>`;
}

export function rowsToTableHtml<T>(rows: T[], columns: CopyColumn<T>[]): string {
  const head = columns.map((c) => `<th style="${HEAD_STYLE}">${escapeHtml(c.label)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${columns.map((c) => htmlCell(c, row)).join("")}</tr>`)
    .join("");
  return `<table style="border-collapse:collapse;border:${BORDER};"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ");
}

export function rowsToTsv<T>(rows: T[], columns: CopyColumn<T>[]): string {
  const lines = [columns.map((c) => tsvCell(c.label))];
  for (const row of rows) lines.push(columns.map((c) => tsvCell(c.text(row))));
  return lines.map((cells) => cells.join("\t")).join("\n");
}

// Writes the rich HTML + TSV pair when the environment supports it. A rejected
// rich write (focus lost, WebViews without `text/html` blobs) falls back to
// TSV-only; a missing `navigator.clipboard` makes `writeText` throw, which the
// caller reports as a failed copy.
async function writeTable(text: string, html: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (typeof ClipboardItem !== "undefined" && typeof clipboard?.write === "function") {
    try {
      await clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to the plain-text copy below.
    }
  }
  await clipboard.writeText(text);
}

// Copies the rows as an HTML table + TSV and reports the result through the
// caller's toast setter. Falls back to TSV-only where rich clipboard writes
// are unavailable. Returns the promise so tests can await the clipboard write.
export async function copyRowsAsTable<T>(
  rows: T[],
  columns: CopyColumn<T>[],
  setToast: (message: string | null) => void,
  toastMs = 2000,
): Promise<void> {
  const show = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), toastMs);
  };
  if (rows.length === 0 || columns.length === 0) {
    show("No rows to copy");
    return;
  }
  try {
    await writeTable(rowsToTsv(rows, columns), rowsToTableHtml(rows, columns));
  } catch {
    show("Copy failed");
    return;
  }
  show(rows.length === 1 ? "Row copied" : `${rows.length} rows copied`);
}
