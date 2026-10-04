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
export async function copyRowUrls(
  rows: Array<{ webUrl?: string | null }>,
  setToast: (message: string | null) => void,
  toastMs = 2000,
): Promise<void> {
  const show = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), toastMs);
  };
  const text = urlsToClipboardText(rows);
  const count = text === "" ? 0 : text.split("\n").length;
  if (count === 0) {
    show("No URL to copy");
    return;
  }
  try {
    // `navigator.clipboard` can be undefined (insecure context), which throws
    // here rather than rejecting, so it is handled with the rejection case.
    await navigator.clipboard.writeText(text);
  } catch {
    show("Copy failed");
    return;
  }
  show(count === 1 ? "URL copied" : `${count} URLs copied`);
}
