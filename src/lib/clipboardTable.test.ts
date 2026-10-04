import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyRowsAsTable, rowsToTableHtml, rowsToTsv, type CopyColumn } from "./clipboardTable";

type Row = { id: number; title: string; url: string | null };

const columns: CopyColumn<Row>[] = [
  { label: "#", text: (r) => `#${r.id}`, href: (r) => r.url },
  { label: "Title", text: (r) => r.title },
];
const rows: Row[] = [
  { id: 1, title: "A <b> & \"c\"", url: "https://example.com/1" },
  { id: 2, title: "multi\nline\ttab", url: null },
];

describe("rowsToTableHtml", () => {
  it("renders a header row and escaped, inline-styled cells", () => {
    const html = rowsToTableHtml(rows, columns);
    expect(html).toContain("<th");
    expect(html).toContain("A &lt;b&gt; &amp; &quot;c&quot;");
    expect(html).toContain('style="border:1px solid');
  });

  it("links only cells that have an http(s) href", () => {
    const html = rowsToTableHtml(
      [...rows, { id: 3, title: "x", url: "javascript:alert(1)" }],
      columns,
    );
    expect(html).toContain('<a href="https://example.com/1">#1</a>');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("keeps empty cells one line tall", () => {
    const html = rowsToTableHtml([{ id: 1, title: "", url: null }], columns);
    expect(html).toContain("&nbsp;");
  });
});

describe("rowsToTsv", () => {
  it("emits a header and flattens tabs/newlines inside cells", () => {
    expect(rowsToTsv(rows, columns)).toBe('#\tTitle\n#1\tA <b> & "c"\n#2\tmulti line tab');
  });
});

describe("copyRowsAsTable", () => {
  const writeText = vi.fn(() => Promise.resolve());
  const write = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockClear();
    write.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, write },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("writes HTML and plain text together when ClipboardItem exists", async () => {
    const items: Record<string, Blob>[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(data: Record<string, Blob>) {
          items.push(data);
        }
      },
    );
    const setToast = vi.fn();
    await copyRowsAsTable(rows, columns, setToast);
    expect(write).toHaveBeenCalledTimes(1);
    expect(Object.keys(items[0]).sort()).toEqual(["text/html", "text/plain"]);
    expect(writeText).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith("2 rows copied");
  });

  it("falls back to TSV text without ClipboardItem", async () => {
    const setToast = vi.fn();
    await copyRowsAsTable([rows[0]], columns, setToast);
    expect(writeText).toHaveBeenCalledWith('#\tTitle\n#1\tA <b> & "c"');
    expect(setToast).toHaveBeenCalledWith("Row copied");
  });

  it("falls back to TSV text when the rich clipboard write is rejected", async () => {
    vi.stubGlobal("ClipboardItem", class {});
    write.mockRejectedValueOnce(new Error("not allowed"));
    const setToast = vi.fn();
    await copyRowsAsTable([rows[0]], columns, setToast);
    expect(writeText).toHaveBeenCalledWith('#\tTitle\n#1\tA <b> & "c"');
    expect(setToast).toHaveBeenCalledWith("Row copied");
  });

  it("reports a failed copy when both the rich and plain writes are rejected", async () => {
    vi.stubGlobal("ClipboardItem", class {});
    write.mockRejectedValueOnce(new Error("not allowed"));
    writeText.mockRejectedValueOnce(new Error("denied"));
    const setToast = vi.fn();
    await copyRowsAsTable(rows, columns, setToast);
    expect(setToast).toHaveBeenCalledWith("Copy failed");
  });

  it("reports a failed copy instead of throwing when navigator.clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const setToast = vi.fn();
    await expect(copyRowsAsTable(rows, columns, setToast)).resolves.toBeUndefined();
    expect(setToast).toHaveBeenCalledWith("Copy failed");
  });

  it("does not touch the clipboard when there are no rows", async () => {
    const setToast = vi.fn();
    await copyRowsAsTable([], columns, setToast);
    expect(writeText).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith("No rows to copy");
  });

  it("reports a failed clipboard write and clears the toast", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const setToast = vi.fn();
    await copyRowsAsTable(rows, columns, setToast);
    expect(setToast).toHaveBeenCalledWith("Copy failed");
    vi.runAllTimers();
    expect(setToast).toHaveBeenLastCalledWith(null);
  });
});

describe("formula injection guard", () => {
  const formulaRows: Row[] = [
    { id: 1, title: '=HYPERLINK("http://example.com","click")', url: null },
    { id: 2, title: "+1+1", url: null },
    { id: 3, title: "-2", url: null },
    { id: 4, title: "@SUM(1)", url: null },
    { id: 5, title: "\t=1+1", url: null },
    { id: 6, title: "plain = title", url: null },
  ];

  it("prefixes TSV cells that start with a formula character", () => {
    const lines = rowsToTsv(formulaRows, columns).split("\n");
    expect(lines[1]).toBe('#1\t\'=HYPERLINK("http://example.com","click")');
    expect(lines[2]).toBe("#2\t'+1+1");
    expect(lines[3]).toBe("#3\t'-2");
    expect(lines[4]).toBe("#4\t'@SUM(1)");
    expect(lines[5]).toBe("#5\t' =1+1");
    expect(lines[6]).toBe("#6\tplain = title");
  });

  it("prefixes HTML cells that start with a formula character", () => {
    const html = rowsToTableHtml(formulaRows, columns);
    expect(html).toContain("'=HYPERLINK(&quot;http://example.com&quot;");
    expect(html).toContain(">'+1+1</td>");
    expect(html).toContain(">plain = title</td>");
  });

  it("leaves ID cells such as #123 untouched", () => {
    expect(rowsToTsv([formulaRows[5]], columns).split("\n")[1]).toMatch(/^#6\t/);
  });
});
