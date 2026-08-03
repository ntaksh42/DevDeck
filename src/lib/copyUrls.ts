// Ctrl+C in the grids copies the web URL of every selected row, one per line.
// Rows without a web URL (demo fixtures, responses missing the field) are
// skipped rather than copied as blank lines.
export function urlsToClipboardText(rows: Array<{ webUrl?: string | null }>): string {
  return rows
    .map((row) => row.webUrl)
    .filter((url): url is string => typeof url === "string" && url !== "")
    .join("\n");
}

// Copies the selected rows' URLs and reports the result through the caller's
// toast setter. Returns the promise so tests can await the clipboard write.
export function copyRowUrls(
  rows: Array<{ webUrl?: string | null }>,
  setToast: (message: string | null) => void,
  toastMs = 2000,
): Promise<void> {
  const text = urlsToClipboardText(rows);
  const count = text === "" ? 0 : text.split("\n").length;
  if (count === 0) {
    setToast("No URL to copy");
    window.setTimeout(() => setToast(null), toastMs);
    return Promise.resolve();
  }
  return navigator.clipboard.writeText(text).then(
    () => {
      setToast(count === 1 ? "URL copied" : `${count} URLs copied`);
      window.setTimeout(() => setToast(null), toastMs);
    },
    () => {
      setToast("Copy failed");
      window.setTimeout(() => setToast(null), toastMs);
    },
  );
}
