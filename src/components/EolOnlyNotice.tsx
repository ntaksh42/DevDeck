// Shown instead of an apparently empty diff when only the newline style changed
// (e.g. "LF → CRLF"): the normalized diff has no line changes, but the file did.
export function EolOnlyNotice({ change }: { change: string }) {
  return (
    <p className="border-b border-border bg-blue-50 px-2 py-1 text-[11px] text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
      Only line endings changed ({change}); the text content is identical.
    </p>
  );
}
